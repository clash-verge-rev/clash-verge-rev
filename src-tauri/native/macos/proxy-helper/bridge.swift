import Foundation
import Security
import ServiceManagement

@objc(CVProxyHelperProtocol)
protocol CVProxyHelperProtocol {
  func ping(_ reply: @escaping (Bool) -> Void)
  func applyProxy(_ payload: Data, withReply reply: @escaping (Data?, NSError?) -> Void)
}

struct CVBridgeStatus: Codable {
  let installed: Bool
  let xpcReady: Bool
  let message: String?
}

struct CVBridgeResult: Codable {
  let success: Bool
  let message: String
}

enum CVBridgeError: Error {
  case invalidArguments(String)
  case authFailed(String)
  case blessFailed(String)
  case xpcFailed(String)
  case ioFailed(String)
}

private func printJSON<T: Encodable>(_ obj: T) {
  let enc = JSONEncoder()
  enc.outputFormatting = [.sortedKeys]
  if let data = try? enc.encode(obj), let text = String(data: data, encoding: .utf8) {
    print(text)
  } else {
    print("{\"success\":false,\"message\":\"json_encode_failed\"}")
  }
}

private func helperPath(_ label: String) -> String {
  "/Library/PrivilegedHelperTools/\(label)"
}

private func launchdPath(_ label: String) -> String {
  "/Library/LaunchDaemons/\(label).plist"
}

private func isInstalled(_ label: String) -> Bool {
  FileManager.default.fileExists(atPath: helperPath(label)) &&
    FileManager.default.fileExists(atPath: launchdPath(label))
}

private func xpcPing(_ label: String, timeout: TimeInterval = 2.5) -> Bool {
  let conn = NSXPCConnection(machServiceName: label, options: .privileged)
  conn.remoteObjectInterface = NSXPCInterface(with: CVProxyHelperProtocol.self)
  let sem = DispatchSemaphore(value: 0)
  var ok = false
  let proxy = conn.remoteObjectProxyWithErrorHandler { _ in
    sem.signal()
  } as? CVProxyHelperProtocol
  conn.resume()
  proxy?.ping { alive in
    ok = alive
    sem.signal()
  }
  let result = sem.wait(timeout: .now() + timeout)
  conn.invalidate()
  return result == .success && ok
}

private func acquireAuthorization() throws -> AuthorizationRef {
  var authRef: AuthorizationRef?
  var status = AuthorizationCreate(nil, nil, AuthorizationFlags(), &authRef)
  guard status == errAuthorizationSuccess, let auth = authRef else {
    throw CVBridgeError.authFailed("AuthorizationCreate failed: \(status)")
  }

  var right = AuthorizationItem(name: kSMRightBlessPrivilegedHelper, valueLength: 0, value: nil, flags: 0)
  var rights = AuthorizationRights(count: 1, items: &right)
  let flags: AuthorizationFlags = [.interactionAllowed, .extendRights, .preAuthorize]
  status = AuthorizationCopyRights(auth, &rights, nil, flags, nil)
  guard status == errAuthorizationSuccess else {
    throw CVBridgeError.authFailed("AuthorizationCopyRights failed: \(status)")
  }
  return auth
}

private func bless(_ label: String) throws {
  let auth = try acquireAuthorization()
  var cfError: Unmanaged<CFError>?
  let ok = SMJobBless(kSMDomainSystemLaunchd, label as CFString, auth, &cfError)
  if !ok {
    let err = cfError?.takeRetainedValue()
    throw CVBridgeError.blessFailed((err as Error?)?.localizedDescription ?? "unknown SMJobBless failure")
  }
}

private func readStdin() -> Data {
  FileHandle.standardInput.readDataToEndOfFile()
}

private func xpcApply(_ label: String, payload: Data, timeout: TimeInterval = 5.0) throws -> CVBridgeResult {
  let conn = NSXPCConnection(machServiceName: label, options: .privileged)
  conn.remoteObjectInterface = NSXPCInterface(with: CVProxyHelperProtocol.self)
  let sem = DispatchSemaphore(value: 0)
  var result: CVBridgeResult?
  var callErr: Error?

  let proxy = conn.remoteObjectProxyWithErrorHandler { err in
    callErr = CVBridgeError.xpcFailed(err.localizedDescription)
    sem.signal()
  } as? CVProxyHelperProtocol
  conn.resume()

  proxy?.applyProxy(payload) { data, err in
    defer { sem.signal() }
    if let err {
      callErr = CVBridgeError.xpcFailed(err.localizedDescription)
      return
    }
    guard let data else {
      callErr = CVBridgeError.xpcFailed("empty helper response")
      return
    }
    do {
      result = try JSONDecoder().decode(CVBridgeResult.self, from: data)
    } catch {
      callErr = CVBridgeError.xpcFailed("invalid helper response")
    }
  }

  let waitRes = sem.wait(timeout: .now() + timeout)
  conn.invalidate()

  if waitRes != .success {
    throw CVBridgeError.xpcFailed("xpc apply timeout")
  }
  if let callErr {
    throw callErr
  }
  guard let result else {
    throw CVBridgeError.xpcFailed("xpc apply returned no result")
  }
  return result
}

private func parseLabel(_ args: [String]) throws -> String {
  guard let idx = args.firstIndex(of: "--label"), idx + 1 < args.count else {
    throw CVBridgeError.invalidArguments("missing --label")
  }
  return args[idx + 1]
}

private func run() throws {
  let args = CommandLine.arguments
  guard args.count >= 2 else {
    throw CVBridgeError.invalidArguments("missing command")
  }
  let cmd = args[1]
  let label = try parseLabel(args)

  switch cmd {
  case "status":
    let installed = isInstalled(label)
    let xpcReady = installed ? xpcPing(label) : false
    printJSON(CVBridgeStatus(installed: installed, xpcReady: xpcReady, message: nil))
  case "install":
    try bless(label)
    let installed = isInstalled(label)
    var xpcReady = false
    if installed {
      for _ in 0..<10 {
        if xpcPing(label) {
          xpcReady = true
          break
        }
        Thread.sleep(forTimeInterval: 0.2)
      }
    }
    printJSON(CVBridgeResult(
      success: installed && xpcReady,
      message: installed && xpcReady ? "helper installed and reachable" : "helper installed but xpc not ready"
    ))
  case "apply":
    let payload = readStdin()
    if payload.isEmpty {
      throw CVBridgeError.ioFailed("missing apply payload")
    }
    let result = try xpcApply(label, payload: payload)
    printJSON(result)
  default:
    throw CVBridgeError.invalidArguments("unknown command \(cmd)")
  }
}

do {
  try run()
} catch {
  let message: String
  if let err = error as? CVBridgeError {
    message = String(describing: err)
  } else {
    message = error.localizedDescription
  }
  printJSON(CVBridgeResult(success: false, message: message))
  Foundation.exit(1)
}

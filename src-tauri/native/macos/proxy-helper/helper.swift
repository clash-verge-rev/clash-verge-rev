import Foundation
import Security
import SystemConfiguration

@objc(CVProxyHelperProtocol)
protocol CVProxyHelperProtocol {
  func ping(_ reply: @escaping (Bool) -> Void)
  func applyProxy(_ payload: Data, withReply reply: @escaping (Data?, NSError?) -> Void)
}

struct CVProxyApplyPayload: Codable {
  let httpEnabled: Bool
  let httpHost: String
  let httpPort: Int
  let httpBypass: String
  let pacEnabled: Bool
  let pacURL: String
}

struct CVBridgeResult: Codable {
  let success: Bool
  let message: String
}

final class CVProxyHelperService: NSObject, NSXPCListenerDelegate, CVProxyHelperProtocol {
  private let listener: NSXPCListener

  init(label: String) {
    listener = NSXPCListener(machServiceName: label)
  }

  func run() {
    listener.delegate = self
    listener.resume()
    RunLoop.current.run()
  }

  func listener(_ listener: NSXPCListener, shouldAcceptNewConnection newConnection: NSXPCConnection) -> Bool {
    newConnection.exportedInterface = NSXPCInterface(with: CVProxyHelperProtocol.self)
    newConnection.exportedObject = self
    newConnection.resume()
    return true
  }

  func ping(_ reply: @escaping (Bool) -> Void) {
    reply(true)
  }

  func applyProxy(_ payload: Data, withReply reply: @escaping (Data?, NSError?) -> Void) {
    do {
      let req = try JSONDecoder().decode(CVProxyApplyPayload.self, from: payload)
      try applyProxySettings(req)
      let result = CVBridgeResult(success: true, message: "ok")
      reply(try JSONEncoder().encode(result), nil)
    } catch {
      let err = NSError(domain: "CVProxyHelper", code: 1001, userInfo: [
        NSLocalizedDescriptionKey: error.localizedDescription
      ])
      reply(nil, err)
    }
  }
}

private func mutateProxies(_ updater: (inout [String: Any]) -> Void) throws {
  guard let prefs = SCPreferencesCreate(nil, "clash-verge-proxy-helper" as CFString, nil),
        let currentSet = SCNetworkSetCopyCurrent(prefs),
        let services = SCNetworkSetCopyServices(currentSet) as? [SCNetworkService] else {
    throw NSError(domain: "CVProxyHelper", code: 2001, userInfo: [
      NSLocalizedDescriptionKey: "failed to open SCPreferences"
    ])
  }

  for service in services {
    guard let protocolRef = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeProxies) else {
      continue
    }
    var cfg = (SCNetworkProtocolGetConfiguration(protocolRef) as? [String: Any]) ?? [:]
    updater(&cfg)
    SCNetworkProtocolSetConfiguration(protocolRef, cfg as CFDictionary)
  }

  guard SCPreferencesCommitChanges(prefs), SCPreferencesApplyChanges(prefs) else {
    throw NSError(domain: "CVProxyHelper", code: 2002, userInfo: [
      NSLocalizedDescriptionKey: "failed to commit/apply SCPreferences"
    ])
  }
}

private func applyProxySettings(_ req: CVProxyApplyPayload) throws {
  try mutateProxies { cfg in
    let proxyFlag = req.httpEnabled ? 1 : 0
    cfg[kSCPropNetProxiesHTTPEnable as String] = proxyFlag
    cfg[kSCPropNetProxiesHTTPSEnable as String] = proxyFlag
    cfg[kSCPropNetProxiesSOCKSEnable as String] = proxyFlag

    if req.httpEnabled {
      cfg[kSCPropNetProxiesHTTPProxy as String] = req.httpHost
      cfg[kSCPropNetProxiesHTTPSProxy as String] = req.httpHost
      cfg[kSCPropNetProxiesSOCKSProxy as String] = req.httpHost
      cfg[kSCPropNetProxiesHTTPPort as String] = req.httpPort
      cfg[kSCPropNetProxiesHTTPSPort as String] = req.httpPort
      cfg[kSCPropNetProxiesSOCKSPort as String] = req.httpPort

      let bypassList = req.httpBypass
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      cfg[kSCPropNetProxiesExceptionsList as String] = bypassList
    } else {
      cfg.removeValue(forKey: kSCPropNetProxiesHTTPProxy as String)
      cfg.removeValue(forKey: kSCPropNetProxiesHTTPSProxy as String)
      cfg.removeValue(forKey: kSCPropNetProxiesSOCKSProxy as String)
      cfg.removeValue(forKey: kSCPropNetProxiesHTTPPort as String)
      cfg.removeValue(forKey: kSCPropNetProxiesHTTPSPort as String)
      cfg.removeValue(forKey: kSCPropNetProxiesSOCKSPort as String)
      cfg.removeValue(forKey: kSCPropNetProxiesExceptionsList as String)
    }

    let pacFlag = req.pacEnabled ? 1 : 0
    cfg[kSCPropNetProxiesProxyAutoConfigEnable as String] = pacFlag
    if req.pacEnabled {
      cfg[kSCPropNetProxiesProxyAutoConfigURLString as String] = req.pacURL
    } else {
      cfg.removeValue(forKey: kSCPropNetProxiesProxyAutoConfigURLString as String)
    }
  }
}

let helperLabel = Bundle.main.bundleIdentifier ?? "__HELPER_LABEL__"
CVProxyHelperService(label: helperLabel).run()

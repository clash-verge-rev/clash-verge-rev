import Darwin
import Foundation

struct Status: Codable {
    var mode: String?
    var tun: Bool?
    var proxy: Bool?
    var error: String?
    var language: String?
}

func localized(_ key: String, language: String? = nil) -> String {
    let code = language.map { ["jp": "ja", "zh": "zh-Hans", "zhtw": "zh-Hant"][$0] ?? $0 }
    let path = code.flatMap { Bundle.main.path(forResource: $0, ofType: "lproj") }
    let bundle = path.flatMap(Bundle.init(path:)) ?? .main
    return bundle.localizedString(forKey: key, value: nil, table: nil)
}

private func connectSocket(_ path: String) -> Int32? {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return nil }
    var timeout = timeval(tv_sec: 8, tv_usec: 0)
    var noSignal: Int32 = 1
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout.size(ofValue: noSignal)))
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    path.withCString { source in
        withUnsafeMutableBytes(of: &address.sun_path) { bytes in
            bytes.copyMemory(from: UnsafeRawBufferPointer(start: source, count: path.utf8.count + 1))
        }
    }
    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard connected == 0 else {
        close(descriptor)
        return nil
    }
    return descriptor
}

private func sendRequest(_ data: Data, descriptor: Int32) -> Bool {
    data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let count = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return false }
            offset += count
        }
        return true
    }
}

private func readResponse(descriptor: Int32) -> Status? {
    var response = Data(count: 4096)
    var received = 0
    while received < 4096 {
        let count = response.withUnsafeMutableBytes { bytes in
            read(descriptor, bytes.baseAddress!.advanced(by: received), bytes.count - received)
        }
        if count < 0 && errno == EINTR { continue }
        guard count > 0 else { return nil }
        let end = received + count
        if let newline = response[received..<end].firstIndex(of: 10) {
            response.count = newline
            return try? JSONDecoder().decode(Status.self, from: response)
        }
        received = end
    }
    return nil
}

func exchange(action: String = "status", value: String? = nil) -> Status {
    #if PREVIEW_HOST
    return Status(mode: "rule", tun: true, proxy: false, language: "en")
    #else
    #if DEBUG
    if ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" {
        return Status(mode: "rule", tun: true, proxy: false, language: "en")
    }
    #endif
    func unavailable(_ key: String) -> Status { Status(error: key) }
    guard let path = socketPath(), path.utf8.count < 104 else {
        return unavailable("widget.unavailable")
    }
    guard let descriptor = connectSocket(path) else { return unavailable("widget.unavailable") }
    defer { close(descriptor) }
    guard authenticPeer(descriptor, identifier: hostID) else { return unavailable("widget.unavailable") }
    var request = ["action": action]
    if let value { request["value"] = value }
    guard var data = try? JSONSerialization.data(withJSONObject: request) else {
        return unavailable("widget.failed")
    }
    data.append(10)
    guard sendRequest(data, descriptor: descriptor) else { return unavailable("widget.failed") }
    return readResponse(descriptor: descriptor) ?? unavailable("widget.failed")
    #endif
}

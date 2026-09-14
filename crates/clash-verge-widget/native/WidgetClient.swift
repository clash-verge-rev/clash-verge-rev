import Foundation
import Darwin

struct Status: Codable {
    var mode: String?
    var tun: Bool?
    var proxy: Bool?
    var error: String?
    var language: String?
}

func localized(_ key: String, language: String? = nil) -> String {
    let code = language.map { ["jp": "ja", "zh": "zh-Hans", "zhtw": "zh-Hant"][$0] ?? $0 }
    let bundle = code.flatMap { Bundle.main.path(forResource: $0, ofType: "lproj") }.flatMap(Bundle.init(path:)) ?? .main
    return bundle.localizedString(forKey: key, value: nil, table: nil)
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
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return unavailable("widget.unavailable") }
    defer { close(fd) }
    var timeout = timeval(tv_sec: 8, tv_usec: 0)
    var noSignal: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout.size(ofValue: noSignal)))
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
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard connected == 0 else { return unavailable("widget.unavailable") }
    guard authenticPeer(fd, identifier: hostID) else { return unavailable("widget.unavailable") }
    var request = ["action": action]
    if let value { request["value"] = value }
    guard var data = try? JSONSerialization.data(withJSONObject: request) else { return unavailable("widget.failed") }
    data.append(10)
    let sent = data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let count = write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return false }
            offset += count
        }
        return true
    }
    guard sent else { return unavailable("widget.failed") }
    var response = Data(count: 4096)
    var received = 0
    while received < 4096 {
        let count = response.withUnsafeMutableBytes { bytes in
            read(fd, bytes.baseAddress!.advanced(by: received), bytes.count - received)
        }
        if count < 0 && errno == EINTR { continue }
        guard count > 0 else { return unavailable("widget.failed") }
        let end = received + count
        if let newline = response[received..<end].firstIndex(of: 10) {
            response.count = newline
            return (try? JSONDecoder().decode(Status.self, from: response)) ?? unavailable("widget.failed")
        }
        received = end
    }
    return unavailable("widget.failed")
    #endif
}

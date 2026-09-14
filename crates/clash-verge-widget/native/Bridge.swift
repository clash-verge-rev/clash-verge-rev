import Foundation
import Security
import WidgetKit
import Darwin

let widgetKind = "VergeRoutingWidget"
let hostID = "io.github.clash-verge-rev.clash-verge-rev"

func socketPath() -> String? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "VergeWidgetGroup") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
    return container.appendingPathComponent("verge-widget.sock").path
}

func authenticPeer(_ fd: Int32, identifier: String) -> Bool {
    var token = audit_token_t()
    var size = socklen_t(MemoryLayout.size(ofValue: token))
    guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) == 0,
          size == MemoryLayout.size(ofValue: token) else { return false }
    let data = withUnsafeBytes(of: token) { Data($0) }
    var peer: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: data] as CFDictionary, [], &peer) == errSecSuccess,
          let peer,
          let team = Bundle.main.object(forInfoDictionaryKey: "VergeWidgetTeam") as? String,
          team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return false }
    var requirement: SecRequirement?
    let expression = "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and identifier \"\(identifier)\""
    guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
          let requirement else { return false }
    return SecCodeCheckValidity(peer, [], requirement) == errSecSuccess
}

#if !WIDGET_EXTENSION
@_cdecl("verge_widget_path")
public func vergeWidgetPath() -> UnsafeMutablePointer<CChar>? {
    socketPath().flatMap { strdup($0) }
}

@_cdecl("verge_widget_authenticate")
public func vergeWidgetAuthenticate(_ fd: Int32) -> Bool {
    authenticPeer(fd, identifier: hostID + ".widget")
}

@_cdecl("verge_widget_reload")
public func vergeWidgetReload() {
    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
}
#endif

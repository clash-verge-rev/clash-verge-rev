//! macOS Wi-Fi SSID / BSSID 采集：通过 CoreWLAN。
//!
//! 用 `CWWiFiClient.sharedWiFiClient` 拿 client，再按 primary iface 名取 `CWInterface`，
//! 读 `.ssid()` / `.bssid()`。外置 Wi-Fi 卡会注册为 en1 / en2 等，因此必须用
//! `interfaceWithName:` 按名取，而非走便利方法 `interface()`（后者只返回内置 Wi-Fi）。
//!
//! **Location 权限（macOS 14+）**：无 Location 授权时 `ssid()` / `bssid()` 返回 nil
//! （Apple 在 Sonoma 起强制）。我们静默降级到 `None`，不影响 iface_type=wifi / 其他
//! 字段采集。授权 UX 由 [`super::location`] 模块负责（CoreLocation delegate +
//! `verge://wifi-auth-changed` 事件驱动前端刷新）；此模块只负责 API 调用。
//!
//! 失败场景（静默返回 None）：
//! - iface 名不存在 / 非 Wi-Fi 接口（`interfaceWithName:` 返回 nil）
//! - 接口未关联 AP（`ssid()` / `bssid()` 返回 nil）
//! - Location 权限未授（同上，Sonoma+）

use objc2_core_wlan::{CWInterface, CWWiFiClient};
use objc2_foundation::NSString;

/// 判断给定 BSD 接口名是否是 Wi-Fi 网卡（通过 CoreWLAN 查询）。
///
/// **为什么不能只看 `if_data.ifi_type`**：macOS 的 `getifaddrs` 对 802.11 Wi-Fi
/// 网卡也返回 `IFT_ETHER`（6），不用 `IFT_IEEE80211`（71）。这是 Apple 一贯行为
/// （Wi-Fi 在 L2 帧上兼容 Ethernet，内核统一按 ether 汇报）。要可靠区分 Wi-Fi
/// 和有线以太，唯一权威来源是 CoreWLAN：`interfaceWithName:` 返回非 nil 即 Wi-Fi。
///
/// 本查询不依赖 Location 权限（只是类型判断，不读 SSID/BSSID）。
pub fn is_wifi_interface(iface_name: &str) -> bool {
    // SAFETY: 只读类型查询；interfaceWithName 返回 Retained<CWInterface> / None。
    unsafe {
        let client: objc2::rc::Retained<CWWiFiClient> = CWWiFiClient::sharedWiFiClient();
        let name_ns = NSString::from_str(iface_name);
        client.interfaceWithName(Some(&name_ns)).is_some()
    }
}

pub fn read_wifi_info(iface_name: &str) -> (Option<String>, Option<String>) {
    // SAFETY: CoreWLAN Obj-C 消息调用必须在 unsafe block；返回 Retained 智能指针，
    // 生命周期由 objc2 管理，Drop 时自动 release。
    unsafe {
        let client: objc2::rc::Retained<CWWiFiClient> = CWWiFiClient::sharedWiFiClient();
        let name_ns = NSString::from_str(iface_name);
        let Some(iface): Option<objc2::rc::Retained<CWInterface>> = client.interfaceWithName(Some(&name_ns)) else {
            return (None, None);
        };

        // SSID 按 802.11 规范是任意 octet 序列、大小写敏感；matcher 侧按字节精确
        // 比较，原样保留（不做 lowercase），与 Linux / Windows 行为一致
        let ssid = iface.ssid().map(|s| s.to_string()).filter(|s| !s.is_empty());
        // BSSID 归一化：小写冒号分隔（mihomo 内核期望的形式）。过滤空字符串以及
        // 部分驱动在"未关联 AP"时返回的占位值 `00:00:00:00:00:00`（与 Linux /
        // Windows 的空值语义对齐）
        let bssid = iface
            .bssid()
            .map(|s| s.to_string().to_ascii_lowercase())
            .filter(|s| !s.is_empty() && s != "00:00:00:00:00:00");
        (ssid, bssid)
    }
}

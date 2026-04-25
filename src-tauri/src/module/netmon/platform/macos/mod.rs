//! macOS 平台 netmon 实现。
//!
//! - [`sampler`]：SCDynamicStore 枚举 active service → per-iface 构造
//!   [`super::super::context::RawIfaceInventory`]；getifaddrs 查 ifi_type 分类；
//!   `has_default_route` 按 service `Router` 是否存在标注；per-iface 填
//!   gateway_ip / gateway_mac。
//! - [`probe`]：纯函数（classify_iface_type_pure / prefix_from_mask / ...）带单测。
//! - [`dns_suffix`]：读 SCDynamicStore `State:/Network/Global/DNS → SearchDomains`。
//! - [`wifi`] / [`location`]：CoreWLAN SSID/BSSID + `is_wifi_interface` 修正；
//!   CoreLocation 授权 UX。
//! - [`monitor`]：SCDynamicStore 回调订阅系统事件。
//!
//! 电源事件复用 lib.rs 的 `RunEvent::Resumed` hook（与 Windows 方案一致），不
//! 单独订阅 NSWorkspaceDidWakeNotification。

pub mod dns_suffix;
pub mod location;
mod monitor;
mod probe;
mod sampler;
mod wifi;

pub use monitor::MacosMonitor;
pub use sampler::MacosSampler;

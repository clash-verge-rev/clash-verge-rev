//! Windows 平台 netmon 实现。
//!
//! - [`sampler`]：`GetAdaptersAddresses` 枚举 admin-up 适配器 →
//!   [`super::super::context::RawIfaceInventory`]；`GetIpForwardTable2` 标注
//!   `has_default_route`；per-iface 填 gateway_ip / gateway_mac。
//! - [`probe`]：纯函数（classify_iface_type_pure / prefix_from_mask / ...）带单测。
//! - [`dns_suffix`]：解析 `GetAdaptersAddresses.SuffixSearchList` 得到 DNS search list。
//! - [`wifi`]：通过 WlanAPI 采集当前 Wi-Fi SSID / BSSID。
//! - [`monitor`]：`NotifyIpInterfaceChange` + `WlanRegisterNotification` 订阅系统事件。
//!
//! 电源事件（Modern Standby resume）由 `lib.rs::event_handlers::handle_resumed`
//! 通过 `RunEvent::Resumed` hook + 重新订阅后 IP Helper drain 事件双路兜底，
//! 本模块不直接订阅 `PowerRegisterSuspendResumeNotification`。

pub mod dns_suffix;
mod monitor;
mod probe;
mod sampler;
mod wifi;

pub use monitor::WindowsMonitor;
pub use sampler::WindowsSampler;

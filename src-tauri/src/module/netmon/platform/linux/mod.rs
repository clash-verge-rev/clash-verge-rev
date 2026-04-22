//! Linux 平台 netmon 实现。
//!
//! - [`sampler`]：rtnetlink dump 全部 admin-up link + 默认路由的 ifindex 集合 →
//!   per-iface 构造 [`super::super::context::RawIfaceInventory`]；per-iface 填
//!   gateway_ip / gateway_mac。
//! - [`probe`]：纯函数（classify_iface_type / parse_proc_arp / prefix_from_mask
//!   / build_subnets_from / ...）带单测。
//! - [`dns_suffix`]：优先 `resolvectl domain`，失败 fallback 到 `/etc/resolv.conf`。
//! - [`wifi`]：通过 WEXT ioctl 采集当前 Wi-Fi SSID / BSSID。
//! - [`monitor`]：rtnetlink 多播订阅系统事件。

pub mod dns_suffix;
mod monitor;
mod probe;
mod sampler;
mod wifi;

pub use monitor::LinuxMonitor;
pub use sampler::LinuxSampler;

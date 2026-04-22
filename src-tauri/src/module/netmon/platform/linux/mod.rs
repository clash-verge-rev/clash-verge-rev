//! Linux 平台 netmon 实现。
//!
//! 骨架阶段为空 stub；`monitor.rs` / `probe.rs` / `sampler.rs` / `wifi.rs` 由后续
//! commit 填充。`dns_suffix.rs` 作为 stub 先落地（恒返回空 `Vec<String>`），
//! 为 sampler 先行打好调用点。

pub mod dns_suffix;

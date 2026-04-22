//! 平台原生网络事件订阅抽象 + sampler 工厂。
//!
//! 每个平台各实现 [`PlatformMonitor`]，订阅 OS 网络事件（Linux netlink /
//! Windows NotifyIpInterfaceChange / macOS SCDynamicStore）+ 电源事件，并在
//! 事件到达时向 service loop 发送 [`super::TriggerReason::NetworkEvent`] 或
//! [`super::TriggerReason::Resumed`]。
//!
//! 骨架阶段三平台 `sampler.rs` / `monitor.rs` / `probe.rs` / `wifi.rs` 尚未接入，
//! 统一走 `StubMonitor`（no-op）+ `StubSampler`（返回 Unknown），保证运行时不动
//! mihomo；真实 platform 实现由后续 commit 接入。
//!
//! `dns_suffix.rs` 已作为 stub 落地（恒返回空 `Vec<String>`），为各平台 sampler
//! 先行打好调用点；真实采集（systemd-resolved / `GetAdaptersAddresses.SuffixSearchList`
//! / SCDynamicStore `SearchDomains`）由后续 commit 落地。

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tokio::sync::mpsc;

use super::TriggerReason;
use super::sampler::Sampler;
#[cfg(not(target_os = "windows"))]
use super::sampler::StubSampler;

#[async_trait]
pub trait PlatformMonitor: Send + Sync {
    /// 启动订阅。实现应在内部 spawn 任务 / 线程，本调用不阻塞。
    async fn start(&self, tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()>;

    /// 停止订阅。应幂等、best-effort（即使底层 API 失败也不 panic）。
    async fn stop(&self);
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// 按编译目标返回对应平台的 monitor 实例。当前 Windows 已接入真实 monitor；
/// Linux / macOS 仍走 `StubMonitor`，等后续 commit 落地后替换。
pub fn new_platform_monitor() -> Arc<dyn PlatformMonitor> {
    #[cfg(target_os = "windows")]
    {
        Arc::new(windows::WindowsMonitor::new())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Arc::new(StubMonitor)
    }
}

/// 按编译目标返回对应平台的 sampler 实例。当前 Windows 已接入真实 sampler；
/// Linux / macOS 仍走 `StubSampler`（一律返回 `Sample::Unknown`），等后续 commit
/// 落地后替换。
pub fn new_sampler() -> Arc<dyn Sampler> {
    #[cfg(target_os = "windows")]
    {
        Arc::new(windows::WindowsSampler)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Arc::new(StubSampler)
    }
}

/// 未支持平台 fallback 使用；从不触发事件。
#[cfg(not(target_os = "windows"))]
struct StubMonitor;

#[cfg(not(target_os = "windows"))]
#[async_trait]
impl PlatformMonitor for StubMonitor {
    async fn start(&self, _tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        Ok(())
    }
    async fn stop(&self) {}
}

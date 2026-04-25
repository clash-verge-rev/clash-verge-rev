//! 平台原生网络事件订阅抽象 + sampler 工厂。
//!
//! 每个平台各实现 [`PlatformMonitor`]，订阅 OS 网络事件（Linux netlink /
//! Windows NotifyIpInterfaceChange / macOS SCDynamicStore）+ 电源事件，并在
//! 事件到达时向 service loop 发送 [`super::TriggerReason::NetworkEvent`] 或
//! [`super::TriggerReason::Resumed`]。
//!
//! 未支持平台（BSD 等非 tier-1 target）走 `StubMonitor`（no-op）+ `StubSampler`
//! （返回 Unknown），运行时不向 mihomo 发请求。

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tokio::sync::mpsc;

use super::TriggerReason;
use super::sampler::Sampler;
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
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
// `pub(super)` 而非 `mod`：`super::super::wifi_auth`（`netmon/mod.rs`）需要
// 绕过 `PlatformMonitor` / `Sampler` 公共抽象直接 re-export `macos::location`
// 的 3 个 fn（主线程 CoreLocation wrapper），避免把 CoreLocation UX 硬塞进
// `PlatformMonitor` trait。linux / windows 没有类似跨层引用，保持私有即可。
#[cfg(target_os = "macos")]
pub(super) mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// 按编译目标返回对应平台的 monitor 实例；其他 target（BSD 等）走 `StubMonitor`。
pub fn new_platform_monitor() -> Arc<dyn PlatformMonitor> {
    #[cfg(target_os = "windows")]
    {
        Arc::new(windows::WindowsMonitor::new())
    }
    #[cfg(target_os = "macos")]
    {
        Arc::new(macos::MacosMonitor::new())
    }
    #[cfg(target_os = "linux")]
    {
        Arc::new(linux::LinuxMonitor::new())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Arc::new(StubMonitor)
    }
}

/// 按编译目标返回对应平台的 sampler 实例；其他 target（BSD 等）走 `StubSampler`。
pub fn new_sampler() -> Arc<dyn Sampler> {
    #[cfg(target_os = "windows")]
    {
        Arc::new(windows::WindowsSampler)
    }
    #[cfg(target_os = "macos")]
    {
        Arc::new(macos::MacosSampler)
    }
    #[cfg(target_os = "linux")]
    {
        Arc::new(linux::LinuxSampler)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Arc::new(StubSampler)
    }
}

/// 未支持平台 fallback 使用；从不触发事件。
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
struct StubMonitor;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
#[async_trait]
impl PlatformMonitor for StubMonitor {
    async fn start(&self, _tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        Ok(())
    }
    async fn stop(&self) {}
}

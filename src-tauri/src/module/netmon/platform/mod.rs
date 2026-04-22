//! 平台原生网络事件订阅抽象 + sampler 工厂。
//!
//! 每个平台各实现 [`PlatformMonitor`]，订阅 OS 网络事件（Linux netlink /
//! Windows NotifyIpInterfaceChange / macOS SCDynamicStore）+ 电源事件，并在
//! 事件到达时向 service loop 发送 [`super::TriggerReason::NetworkEvent`] 或
//! [`super::TriggerReason::Resumed`]。
//!
//! 骨架阶段三平台 `sampler.rs` / `monitor.rs` / `probe.rs` / `wifi.rs` /
//! `dns_suffix.rs` 尚未接入，统一走 `StubMonitor`（no-op）+ `StubSampler`
//! （返回 Unknown），保证运行时不动 mihomo；真实 platform 实现由后续 commit
//! 接入。

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tokio::sync::mpsc;

use super::TriggerReason;
use super::sampler::{Sampler, StubSampler};

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

/// 按编译目标返回对应平台的 monitor 实例。骨架阶段三平台统一走 `StubMonitor`，
/// 平台 impl 接入后由 cfg 分支决定。
#[allow(dead_code)] // 由 mod.rs::start() 调用，骨架阶段尚未接入
pub fn new_platform_monitor() -> Arc<dyn PlatformMonitor> {
    Arc::new(StubMonitor)
}

/// 按编译目标返回对应平台的 sampler 实例。骨架阶段三平台统一走 `StubSampler`
/// （一律返回 `Sample::Unknown`），平台 impl 接入后由 cfg 分支决定。
#[allow(dead_code)] // 由 mod.rs::start() 调用，骨架阶段尚未接入
pub fn new_sampler() -> Arc<dyn Sampler> {
    Arc::new(StubSampler)
}

/// 未支持平台 fallback 使用；从不触发事件。
struct StubMonitor;

#[async_trait]
impl PlatformMonitor for StubMonitor {
    async fn start(&self, _tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        Ok(())
    }
    async fn stop(&self) {}
}

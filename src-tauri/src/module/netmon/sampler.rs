//! 网络上下文采集抽象。
//!
//! 平台各自实现 [`Sampler`]，返回以下两态之一：
//! - `Online`：成功采样；无论 interfaces 是否为空、dns_suffix 是否为空都走这条路径；
//!   service 统一 PUT 给 mihomo
//! - `Unknown`：采集硬失败或 sampler 不可用（例如骨架阶段的 StubSampler，或 netlink
//!   掉线且未恢复）；service 保留上次 state，不动 mihomo
//!
//! **离线态处理**：`Sample::Online(NetworkContext { interfaces: [] })` 即可表达，
//! 无需单独 `Sample::Offline`——mihomo 侧 DELETE 不触发 network-policy 重评估，
//! 空 interfaces 的 PUT 足以通知内核"当前处于离线"。

use anyhow::Result;
use async_trait::async_trait;
use tauri_plugin_mihomo::models::NetworkContext;

#[allow(clippy::large_enum_variant)] // Online 携带 NetworkContext，按值传避免 Box 分配
pub enum Sample {
    /// 成功采样（含"活跃 iface 为空"的离线）。真实 platform sampler 构造此变体；
    /// 骨架阶段 StubSampler 不构造，暂挂 allow(dead_code)。
    #[allow(dead_code)]
    Online(NetworkContext),
    /// 采集硬失败 / sampler 不可用；骨架阶段 StubSampler 一律返回此变体。
    Unknown,
}

#[async_trait]
pub trait Sampler: Send + Sync {
    async fn collect(&self) -> Result<Sample>;
}

/// 占位 sampler：一律返回 `Unknown`。
///
/// 在三平台真实实现接入前使用。service 看到 Unknown 会直接跳过，不会向 mihomo
/// 发请求，保证骨架 commit 运行时完全 no-op——不会覆盖用户通过其他方式推送过的
/// sticky context。
#[cfg_attr(
    any(target_os = "linux", target_os = "windows", target_os = "macos"),
    allow(dead_code)
)]
pub struct StubSampler;

#[async_trait]
impl Sampler for StubSampler {
    async fn collect(&self) -> Result<Sample> {
        Ok(Sample::Unknown)
    }
}

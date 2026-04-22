//! 网络上下文采集抽象。
//!
//! 平台 sampler 实现 [`Sampler::collect_raw`]，返回 [`RawIfaceInventory`]（未归一化
//! 的 iface 集合 + DNS search list）。归一化为 plugin [`NetworkContext`] 的工作由
//! [`super::context::build_context`] 完成；高层 API [`collect_and_build`] 把两步
//! 串成一体，返回 service loop 消费的 [`Sample`]。
//!
//! **离线态处理**：`Sample::Online(NetworkContext { interfaces: [] })` 即可表达，
//! 无需单独 `Sample::Offline`——mihomo 侧 DELETE 不触发 network-policy 重评估，
//! 空 interfaces 的 PUT 足以通知内核"当前处于离线"。

use anyhow::Result;
use async_trait::async_trait;
use tauri_plugin_mihomo::models::NetworkContext;

use super::context::{RawIfaceInventory, build_context};
use super::self_tun_filter::SelfTunSnapshot;

#[allow(clippy::large_enum_variant)] // Online 携带 NetworkContext，按值传避免 Box 分配
pub enum Sample {
    /// 成功采样（含"活跃 iface 为空"的离线）。由 [`collect_and_build`] 构造，service
    /// 统一走 PUT。
    Online(NetworkContext),
    /// 采集硬失败 / sampler 不可用 / build_context 拒绝（例如 duplicate iface name）。
    /// service 跳过本次，保留上次 ctx 不动 mihomo。
    Unknown,
}

#[async_trait]
pub trait Sampler: Send + Sync {
    /// 采集当前 raw iface 集合 + DNS search list。
    ///
    /// 返回 `Ok(Some(inventory))` 表示成功；`Ok(None)` 表示采集硬失败（sampler 不可用，
    /// 例如 netlink socket 掉线未恢复）；`Err(e)` 表示 I/O / OS 原语层面的异常（service
    /// log warn + skip 本次）。
    ///
    /// Sampler 不负责：mihomo 自身 TUN 过滤、虚拟桥过滤、字段归一化、截断；这些全部
    /// 归 [`crate::module::netmon::context::build_context`] 处理。Sampler 只负责
    /// **平台相关采集**（syscall / ioctl / COM 接口调用）。
    async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>>;
}

/// 占位 sampler：一律返回 `Ok(None)`。
///
/// 在三平台真实实现接入前使用。service 看到 `Sample::Unknown` 会直接跳过，不会
/// 向 mihomo 发请求，保证骨架 commit 运行时完全 no-op——不会覆盖用户通过其他
/// 方式推送过的 sticky context。
#[cfg_attr(
    any(target_os = "linux", target_os = "windows", target_os = "macos"),
    allow(dead_code)
)]
pub struct StubSampler;

#[async_trait]
impl Sampler for StubSampler {
    async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
        Ok(None)
    }
}

/// 采集 + 归一化的高层 API。service loop 消费的唯一 Sample 入口。
///
/// 流程：
/// 1. `sampler.collect_raw()` 拿 raw inventory；`None` → `Sample::Unknown`
/// 2. `build_context(raw, self_tun_snap, enable_virtual)`；`None` → `Sample::Unknown`
///    （context.rs step 4 的 duplicate-iface-name sampler bug 降级）
/// 3. 否则 `Sample::Online(ctx)`
///
/// **self_tun snapshot 由 caller 预先 `for_sample()` 取好后传入**，不在此函数内部
/// 调 `SelfTunFilter`——这样 `collect_and_build` 可以用 `SelfTunSnapshot` 做 mock
/// 单测，不必真跑 HTTP refresh 路径。
pub async fn collect_and_build(
    sampler: &dyn Sampler,
    self_tun_snap: SelfTunSnapshot,
    enable_virtual: bool,
) -> Result<Sample> {
    let Some(raw) = sampler.collect_raw().await? else {
        return Ok(Sample::Unknown);
    };
    let Some(ctx) = build_context(raw, self_tun_snap, enable_virtual) else {
        return Ok(Sample::Unknown);
    };
    Ok(Sample::Online(ctx))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::super::context::{IfaceType, RawIface};
    use super::*;
    use anyhow::anyhow;

    struct OkSomeSampler(RawIfaceInventory);
    #[async_trait]
    impl Sampler for OkSomeSampler {
        async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
            Ok(Some(self.0.clone()))
        }
    }

    struct OkNoneSampler;
    #[async_trait]
    impl Sampler for OkNoneSampler {
        async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
            Ok(None)
        }
    }

    struct ErrSampler;
    #[async_trait]
    impl Sampler for ErrSampler {
        async fn collect_raw(&self) -> Result<Option<RawIfaceInventory>> {
            Err(anyhow!("netlink socket dropped"))
        }
    }

    fn iface(name: &str) -> RawIface {
        RawIface {
            name: name.to_string(),
            iface_type: IfaceType::Ethernet,
            ssid: None,
            bssid: None,
            gateway_ip: None,
            gateway_mac: None,
            subnets: Vec::new(),
            metered: None,
            has_default_route: false,
        }
    }

    #[tokio::test]
    async fn collect_and_build_sampler_ok_none_yields_unknown() {
        let sampler = OkNoneSampler;
        let sample = collect_and_build(&sampler, SelfTunSnapshot::NoFilter, false)
            .await
            .unwrap();
        assert!(matches!(sample, Sample::Unknown));
    }

    #[tokio::test]
    async fn collect_and_build_sampler_ok_some_produces_online() {
        let sampler = OkSomeSampler(RawIfaceInventory {
            interfaces: vec![iface("en0")],
            dns_suffix: Vec::new(),
        });
        let sample = collect_and_build(&sampler, SelfTunSnapshot::NoFilter, false)
            .await
            .unwrap();
        match sample {
            Sample::Online(ctx) => {
                assert_eq!(ctx.interfaces.len(), 1);
                assert_eq!(ctx.interfaces[0].name, "en0");
                assert_eq!(ctx.version, 1);
            }
            Sample::Unknown => panic!("expected Online, got Unknown"),
        }
    }

    #[tokio::test]
    async fn collect_and_build_sampler_err_propagates() {
        let sampler = ErrSampler;
        let result = collect_and_build(&sampler, SelfTunSnapshot::NoFilter, false).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn collect_and_build_duplicate_iface_downgrades_to_unknown() {
        // build_context step 4 返回 None 时 collect_and_build 降级为 Sample::Unknown
        let sampler = OkSomeSampler(RawIfaceInventory {
            interfaces: vec![iface("en0"), iface("en0")],
            dns_suffix: Vec::new(),
        });
        let sample = collect_and_build(&sampler, SelfTunSnapshot::NoFilter, false)
            .await
            .unwrap();
        assert!(matches!(sample, Sample::Unknown));
    }

    #[tokio::test]
    async fn collect_and_build_known_snapshot_filters_tun() {
        // SelfTunSnapshot::Known 传入后，build_context 的 step 1 过滤该 iface
        let sampler = OkSomeSampler(RawIfaceInventory {
            interfaces: vec![iface("utun4"), iface("en0")],
            dns_suffix: Vec::new(),
        });
        let sample = collect_and_build(&sampler, SelfTunSnapshot::Known("utun4".into()), false)
            .await
            .unwrap();
        match sample {
            Sample::Online(ctx) => {
                assert_eq!(ctx.interfaces.len(), 1);
                assert_eq!(ctx.interfaces[0].name, "en0");
            }
            Sample::Unknown => panic!("expected Online"),
        }
    }
}

//! mihomo 自身 TUN 的识别与过滤。
//!
//! 骨架阶段只提供类型骨架（`SelfTunFilter` / `SelfTunSnapshot`），所有查询
//! 方法返回 `SelfTunSnapshot::NoFilter`。后续 commit 会替换为完整状态机：
//! `{Uninitialized, Known(name), Unavailable}` + startup / core_ready /
//! host_config_reload / lazy retry 四个触发器 + 三段式锁（不持锁跨 HTTP await）。
//!
//! 前置到骨架阶段是为了让 `context.rs` 的 `build_context(..., self_tun:
//! SelfTunSnapshot, ...)` 以及 `collect_and_build(..., self_tun: &SelfTunFilter, ...)`
//! 的符号树就位，避免跨 commit 的前向依赖。

/// 供 context.rs 归一化使用的快照。
#[derive(Debug, Clone)]
pub enum SelfTunSnapshot {
    /// 识别到了 mihomo 自身 TUN 的 iface 名；归一化时过滤 `iface.name == name`
    #[allow(dead_code)] // 真实状态机接入后才构造
    Known(String),
    /// 未知或 TUN 未启用；不过滤（mihomo TUN 会以 `iface_type=vpn` 出现在 interfaces[]）
    NoFilter,
}

/// mihomo 自身 TUN 的识别 filter。
///
/// 骨架阶段所有方法都返回 `NoFilter`；真实状态机由后续 commit 接入。
pub struct SelfTunFilter;

impl SelfTunFilter {
    pub const fn new() -> Self {
        Self
    }

    /// 应用启动时的 best-effort 探测（stub：no-op）。
    #[allow(dead_code)] // 真实状态机接入后才由 netmon::start 调用
    pub async fn on_startup(&self) {}

    /// mihomo core 就绪 / 重启后的强制 refresh（stub：no-op）。
    #[allow(dead_code)] // 真实状态机接入后才由 on_core_ready 调用
    pub async fn on_core_ready(&self) {}

    /// Host 配置热重载后刷新缓存（stub：no-op）。
    ///
    /// step 2 / step 3 由调用方通过 `netmon::trigger(TriggerReason::Manual)`
    /// 借 service loop 的 debounce + 条件 PUT 完成，不在 self_tun_filter 内部。
    #[allow(dead_code)] // 真实状态机接入后才由 on_host_config_reload 调用
    pub async fn on_host_config_reload(&self) {}

    /// Sample 前获取当前快照（stub：一律返回 `NoFilter`）。
    pub async fn for_sample(&self) -> SelfTunSnapshot {
        SelfTunSnapshot::NoFilter
    }
}

impl Default for SelfTunFilter {
    fn default() -> Self {
        Self::new()
    }
}

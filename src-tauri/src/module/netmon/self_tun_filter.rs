//! mihomo 自身 TUN 的识别与过滤。
//!
//! CVR sampler 枚举系统上所有活跃 iface，但 mihomo 自己开的 TUN（Linux tun 子系统 /
//! Windows Wintun / macOS utun）对 matcher 语义恒定无价值，且会和用户装的 VPN
//! 混淆。解决方案：通过 Clash REST `GET /configs.tun.device` 读 mihomo 的 TUN
//! iface 名，在 [`super::context::build_context`] 的 step 1 过滤掉。
//!
//! # 状态机
//!
//! ```text
//! { Uninitialized, Known(name), Unavailable }
//!   - Uninitialized：启动竞争窗口的瞬态，过滤语义等价 Unavailable
//!   - Known(n)：过滤时跳过 iface.name == n
//!   - Unavailable：拿不到名字（TUN 未启用 / GET 失败 / device 为空）—— 不过滤
//! ```
//!
//! # 触发器
//!
//! - **on_startup**：预留 best-effort 探测 hook，当前未在 `netmon::start` 中调用。
//!   启动期的首个 `for_sample` 在 `Uninitialized` 状态下立即发 HTTP（`last_attempt is
//!   None` → 进 due 分支），效果等价。
//! - **on_core_ready**（每次 CoreManager::start_core Ok 后）：强制 refresh。mihomo
//!   此刻确保就绪，这是 Known(name) 状态的主获取点。
//! - **on_host_config_reload**（每次 apply_config 的 reload 子路径 A 成功后）：用户
//!   可能改了 `tun.device`，强制 refresh。失败保留前次 + warn。
//! - **for_sample**（sampler 每次采样前）：懒式重试节流
//!   - Unavailable + last_attempt > 60s → 重新 GET /configs
//!   - Known(n)    + last_attempt > 5min → refresh（cover mihomo 自发 reload）
//!
//! # 并发契约：三段式锁 + 单调 seq
//!
//! `for_sample` 与 `refresh_http` 都可能发 HTTP（`Mihomo::get_base_config`）。持有
//! `inner.lock().await` 跨 HTTP await 会让 sampler 热路径、config reload refresh、
//! 懒式重试全部串到一次 HTTP round-trip 上——mihomo 慢时等待扩散到整个 netmon。
//! 所以每次调用拆成三段：
//!
//! 1. **短锁** 判断是否该 refresh + 递增 `refresh_seq` 拿到 `my_seq` + 更新
//!    `last_attempt`（HTTP 前置记录）
//! 2. **释放锁** 发 HTTP
//! 3. **再取锁** 校验 `inner.refresh_seq == my_seq`，等则写最终状态；否则丢弃
//!    （已有更新的 attempt 在跑，"后进 step 1 者胜出"）
//!
//! `refresh_seq` 解决的问题：并发两次 refresh A / B 的 HTTP round-trip 可能乱序完成，
//! 若不校验，晚到的 A 会用较旧结果覆盖 B 刚写的较新 state。用单调递增 seq 让 step 3
//! 仅在"我仍是最新尝试"时才写入。注：seq 校验不区分 Ok/Err 结果——若较晚 step 1 的
//! 那次 HTTP 失败而较早的成功，成功的结果也会被 seq 丢弃；交由下一次 for_sample /
//! force-refresh 重取（`last_attempt=None` 已保证下次立即 due）。
//!
//! `last_attempt` 在步骤 1 更新，避免并发 `for_sample` 同一时刻都判定 "due" 发重复
//! HTTP。force-refresh（CoreReady / ConfigReload）失败时在 step 3 把 `last_attempt`
//! 回退到 `None`，防止一次瞬时失败把 Known(old) 状态锁在 300s 节流窗内（典型时序：
//! tun.device 刚变 → on_core_ready 失败 → for_sample 300s 内不重试，CVR 按旧名继续
//! 过滤）。

use std::time::{Duration, Instant};

use anyhow::Context as _;
use clash_verge_logging::{Type, logging};
use tokio::sync::Mutex;

use crate::core::handle::Handle;
use crate::module::netmon::MIHOMO_HTTP_TIMEOUT;

const LAZY_RETRY_UNAVAILABLE: Duration = Duration::from_secs(60);
const LAZY_REFRESH_KNOWN: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, PartialEq, Eq)]
enum SelfTunState {
    Uninitialized,
    Known(String),
    Unavailable,
}

struct SelfTunInner {
    state: SelfTunState,
    /// 上次尝试查询 mihomo `GET /configs` 的时间（成功 / 失败都在 step 1 更新；
    /// force-refresh 失败时 step 3 会回退为 `None` 以解除节流锁，见模块头注释）。
    last_attempt: Option<Instant>,
    /// 上次成功刷新 `tun.device` 的时间（仅成功时更新，失败保留前值）。
    /// 目前不被外部读取，为未来诊断 / 自愈策略留存。
    #[allow(dead_code)]
    last_refresh: Option<Instant>,
    /// 单调递增的 refresh 编号；step 1 `+= 1` 得到 my_seq，step 3 校验相等才写入
    /// （语义见模块头"并发契约"）。
    refresh_seq: u64,
}

/// 供 [`super::context::build_context`] 归一化使用的快照。
#[derive(Debug, Clone)]
pub enum SelfTunSnapshot {
    /// 识别到了 mihomo 自身 TUN 的 iface 名；归一化时过滤 `iface.name == name`
    Known(String),
    /// 未知或 TUN 未启用；不过滤（mihomo TUN 会以 `iface_type=vpn` 出现在 interfaces[]）
    NoFilter,
}

/// mihomo 自身 TUN 的识别 filter。线程安全：内部状态由 `Mutex` 保护，HTTP 调用
/// 不持锁跨 await。
pub struct SelfTunFilter {
    inner: Mutex<SelfTunInner>,
}

impl SelfTunFilter {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(SelfTunInner {
                state: SelfTunState::Uninitialized,
                last_attempt: None,
                last_refresh: None,
                refresh_seq: 0,
            }),
        }
    }

    /// 应用启动触发：best-effort 一次查询，失败不 retry（走懒式重试兜底）。
    ///
    /// 当前未在 `netmon::start` 中调用；启动期的首个 `for_sample` 在 `Uninitialized`
    /// 状态下走懒式重试路径（`last_attempt is None` → 立即发 HTTP），效果等价。
    /// 留作未来把 startup hook 正式接到 `netmon::start` 开头的扩展点。
    #[allow(dead_code)]
    pub async fn on_startup(&self) {
        self.refresh_http(TriggerCtx::StartupBestEffort).await;
    }

    /// mihomo core 就绪 / 重启 / 切换成功后的强制 refresh。失败保留前次 state + warn。
    pub async fn on_core_ready(&self) {
        self.refresh_http(TriggerCtx::CoreReadyForceRefresh).await;
    }

    /// Host 配置热重载后的强制 refresh。只做 step 1（刷新缓存），step 2 / 3
    /// （重采样 + 条件 PUT）由调用方通过 `netmon::trigger(TriggerReason::Manual)`
    /// 借 service loop 的 debounce + fingerprint-skip 统一链路完成。
    pub async fn on_host_config_reload(&self) {
        self.refresh_http(TriggerCtx::ConfigReloadForceRefresh).await;
    }

    /// Sample 前懒式重试：按 state / last_attempt 判定是否发 HTTP，返回当前 snapshot。
    /// HTTP 期间不持内锁，并发 `for_sample` 彼此不串行化；但单次 `for_sample` 本身仍
    /// 会等待自己的 HTTP 完成（最长 `MIHOMO_HTTP_TIMEOUT = 3s`），service loop 的
    /// 单次 process 预算需要把它计入。
    pub async fn for_sample(&self) -> SelfTunSnapshot {
        let now = Instant::now();
        // step 1: 短锁判定 due + 递增 refresh_seq + 更新 last_attempt
        let my_seq = {
            let mut g = self.inner.lock().await;
            let is_due = match &g.state {
                SelfTunState::Uninitialized | SelfTunState::Unavailable => g
                    .last_attempt
                    .is_none_or(|t| now.duration_since(t) >= LAZY_RETRY_UNAVAILABLE),
                SelfTunState::Known(_) => g
                    .last_attempt
                    .is_none_or(|t| now.duration_since(t) >= LAZY_REFRESH_KNOWN),
            };
            if is_due {
                g.refresh_seq = g.refresh_seq.wrapping_add(1);
                g.last_attempt = Some(now);
                Some(g.refresh_seq)
            } else {
                None
            }
        };
        // step 2: 释放锁发 HTTP；step 3: 同一 guard 写最终状态 + 读 snapshot（合并一次锁）
        let guard = if let Some(seq) = my_seq {
            let result = query_mihomo_tun_device().await;
            let mut g = self.inner.lock().await;
            apply_refresh_result_locked(&mut g, seq, now, TriggerCtx::LazyRetry, result);
            g
        } else {
            self.inner.lock().await
        };
        snapshot_of(&guard)
    }

    async fn refresh_http(&self, trigger: TriggerCtx) {
        let now = Instant::now();
        // step 1: 递增 seq + 记录尝试时间
        let my_seq = {
            let mut g = self.inner.lock().await;
            g.refresh_seq = g.refresh_seq.wrapping_add(1);
            g.last_attempt = Some(now);
            g.refresh_seq
        };
        // step 2: 发 HTTP
        let result = query_mihomo_tun_device().await;
        // step 3: 写最终状态（seq 校验在 apply_* 里完成）
        let mut g = self.inner.lock().await;
        apply_refresh_result_locked(&mut g, my_seq, now, trigger, result);
    }
}

impl Default for SelfTunFilter {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
enum TriggerCtx {
    StartupBestEffort,
    CoreReadyForceRefresh,
    ConfigReloadForceRefresh,
    LazyRetry,
}

fn snapshot_of(inner: &SelfTunInner) -> SelfTunSnapshot {
    match &inner.state {
        SelfTunState::Known(n) => SelfTunSnapshot::Known(n.clone()),
        _ => SelfTunSnapshot::NoFilter,
    }
}

/// 纯同步：把 HTTP 结果写入 inner。调用方保证在锁内调用；`my_seq` 与
/// `inner.refresh_seq` 不等时丢弃本次写入（见模块头"并发契约"）。
fn apply_refresh_result_locked(
    inner: &mut SelfTunInner,
    my_seq: u64,
    now: Instant,
    trigger: TriggerCtx,
    result: anyhow::Result<Option<String>>,
) {
    debug_assert!(
        my_seq > 0,
        "my_seq must come from step 1's wrapping_add(1); 0 is the init sentinel"
    );
    if inner.refresh_seq != my_seq {
        logging!(
            debug,
            Type::Network,
            "self_tun_filter: discard stale refresh (my_seq={}, current={}, trigger={:?})",
            my_seq,
            inner.refresh_seq,
            trigger
        );
        return;
    }
    match result {
        Ok(Some(name)) => {
            inner.state = SelfTunState::Known(name);
            inner.last_refresh = Some(now);
        }
        Ok(None) => {
            inner.state = SelfTunState::Unavailable;
            inner.last_refresh = Some(now);
        }
        Err(e) => {
            // 保留前次 state；CoreReady / ConfigReload 路径 warn（用户感知得到的配置
            // 变更），Startup / LazyRetry 路径 debug（预期失败）。
            match trigger {
                TriggerCtx::CoreReadyForceRefresh | TriggerCtx::ConfigReloadForceRefresh => {
                    logging!(
                        warn,
                        Type::Network,
                        "self_tun_filter: refresh failed on {:?}, keep previous state: {:?}",
                        trigger,
                        e
                    );
                    // force-refresh 失败若保留 last_attempt=now，会让 for_sample 的
                    // 节流窗（Known 300s / Unavailable 60s）把"旧 state + 待刷新"的
                    // 组合锁住；典型事故时序：tun.device 刚变 + on_core_ready HTTP 失败
                    // → state 停在 Known(old) + last_attempt=now → 300s 内 CVR 持续按
                    // 旧名过滤。回退为 None 让下次 for_sample 立即 due，尽快自愈。
                    inner.last_attempt = None;
                }
                TriggerCtx::StartupBestEffort | TriggerCtx::LazyRetry => {
                    logging!(
                        debug,
                        Type::Network,
                        "self_tun_filter: refresh skipped/failed on {:?}: {:?}",
                        trigger,
                        e
                    );
                }
            }
        }
    }
}

/// 查询 mihomo `GET /configs`，返回 `Some(tun.device)`、`Ok(None)`（TUN 未启用或
/// device 为空）、或 `Err` (HTTP / plugin 错误 / timeout)。
///
/// **必须同时检查 `tun.enable`**：关闭 TUN 模式后 `tun.device` 字段可能保留历史
/// 残留值（如 "utun4"），只看 `!device.is_empty()` 会把用户后续手建的同名 iface
/// 误过滤。
///
/// 显式用 `MIHOMO_HTTP_TIMEOUT` 包裹，与 sampler `PUT` / `DELETE` 的超时约定一致；
/// 同时封住 `start_core` / `apply_config` 成功路径上 `on_core_ready` /
/// `on_host_config_reload` 的 worst-case 延迟为 3s，而不是沿用 plugin 内部 5s。
// `Handle::mihomo()` 返回 `RwLockReadGuard`；clippy 的
// `significant_drop_tightening` 建议把 guard 生命周期压缩到实际使用点，但
// `get_base_config` 是 `&self` 方法，guard 必须跨 `.await` 存活才能喂给
// `tokio::time::timeout` 的未来对象。inline 不能缩短实际 lock 持有时间。
#[allow(
    clippy::significant_drop_tightening,
    reason = "mihomo RwLockReadGuard must outlive the REST call"
)]
async fn query_mihomo_tun_device() -> anyhow::Result<Option<String>> {
    let mihomo = Handle::mihomo().await;
    let cfg = tokio::time::timeout(MIHOMO_HTTP_TIMEOUT, mihomo.get_base_config())
        .await
        .context("GET /configs timeout")?
        .context("GET /configs")?;
    if !cfg.tun.enable {
        return Ok(None); // TUN 未启用 → 不过滤
    }
    let dev = cfg.tun.device;
    Ok(if dev.is_empty() { None } else { Some(dev) })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    /// 直接操纵 inner state 做测试；绕过 HTTP（`query_mihomo_tun_device` 调真的
    /// `Handle::mihomo()` 测试中无法满足依赖）。
    /// 测试 `apply_refresh_result_locked` 的纯同步逻辑 + snapshot_of 的输出 + 状态
    /// 转换，`for_sample` 的"due 判定"也单独测。
    fn fresh_inner() -> SelfTunInner {
        SelfTunInner {
            state: SelfTunState::Uninitialized,
            last_attempt: None,
            last_refresh: None,
            refresh_seq: 0,
        }
    }

    /// 模拟 step 1：seq += 1 + 记录 last_attempt，返回 my_seq。测试里配合 apply_* 走完三段。
    fn step1(inner: &mut SelfTunInner, now: Instant) -> u64 {
        inner.refresh_seq = inner.refresh_seq.wrapping_add(1);
        inner.last_attempt = Some(now);
        inner.refresh_seq
    }

    #[test]
    fn snapshot_uninitialized_is_no_filter() {
        let inner = fresh_inner();
        assert!(matches!(snapshot_of(&inner), SelfTunSnapshot::NoFilter));
    }

    #[test]
    fn snapshot_unavailable_is_no_filter() {
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Unavailable;
        assert!(matches!(snapshot_of(&inner), SelfTunSnapshot::NoFilter));
    }

    #[test]
    fn snapshot_known_returns_name() {
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Known("utun4".into());
        match snapshot_of(&inner) {
            SelfTunSnapshot::Known(n) => assert_eq!(n, "utun4"),
            SelfTunSnapshot::NoFilter => panic!("expected Known"),
        }
    }

    #[test]
    fn apply_ok_some_transitions_to_known() {
        let mut inner = fresh_inner();
        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(
            &mut inner,
            seq,
            now,
            TriggerCtx::CoreReadyForceRefresh,
            Ok(Some("utun3".into())),
        );
        assert!(matches!(&inner.state, SelfTunState::Known(n) if n == "utun3"));
        assert_eq!(inner.last_refresh, Some(now));
    }

    #[test]
    fn apply_ok_none_transitions_to_unavailable() {
        let mut inner = fresh_inner();
        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(&mut inner, seq, now, TriggerCtx::LazyRetry, Ok(None));
        assert!(matches!(&inner.state, SelfTunState::Unavailable));
        assert_eq!(inner.last_refresh, Some(now));
    }

    #[test]
    fn apply_err_preserves_previous_state_on_lazy_retry() {
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Known("utun3".into());
        inner.last_refresh = Some(Instant::now() - Duration::from_secs(30));
        let saved_last_refresh = inner.last_refresh;

        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(
            &mut inner,
            seq,
            now,
            TriggerCtx::LazyRetry,
            Err(anyhow::anyhow!("connection refused")),
        );
        // state 保留
        assert!(matches!(&inner.state, SelfTunState::Known(n) if n == "utun3"));
        // last_refresh 保留前次（仅成功时才更新）
        assert_eq!(inner.last_refresh, saved_last_refresh);
        // LazyRetry / Startup 路径 Err 保留 last_attempt（沿用 60s / 300s 节流窗）
        assert_eq!(inner.last_attempt, Some(now));
    }

    #[test]
    fn apply_err_on_core_ready_resets_last_attempt_to_unlock_throttle() {
        // 事故时序还原：state 是 Known(old)，on_core_ready 发起 force-refresh 后 HTTP
        // 失败。期望 last_attempt=None，让下一次 for_sample 立即进 due 分支再刷新，
        // 而不是被 300s 节流窗锁住继续按旧名过滤。
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Known("utun3".into());
        let saved_refresh = Some(Instant::now() - Duration::from_secs(30));
        inner.last_refresh = saved_refresh;

        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(
            &mut inner,
            seq,
            now,
            TriggerCtx::CoreReadyForceRefresh,
            Err(anyhow::anyhow!("connection refused")),
        );
        assert!(matches!(&inner.state, SelfTunState::Known(n) if n == "utun3"));
        assert_eq!(inner.last_refresh, saved_refresh);
        assert_eq!(
            inner.last_attempt, None,
            "force-refresh Err must reset last_attempt to None to unlock throttle"
        );
    }

    #[test]
    fn apply_err_on_config_reload_resets_last_attempt_to_unlock_throttle() {
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Known("utun3".into());
        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(
            &mut inner,
            seq,
            now,
            TriggerCtx::ConfigReloadForceRefresh,
            Err(anyhow::anyhow!("timeout")),
        );
        assert_eq!(inner.last_attempt, None);
    }

    #[test]
    fn apply_discards_stale_seq_and_does_not_overwrite_newer_state() {
        // 并发乱序时序还原：A 先 step1（seq=1），B 后 step1（seq=2），B step3 先到
        // 写成 Known("new")；A step3 后到，my_seq=1 != current=2 → 必须被丢弃，
        // 否则 A 的较旧结果会覆盖 B 的较新写入。
        let mut inner = fresh_inner();
        let t_a = Instant::now();
        let a_seq = step1(&mut inner, t_a); // 1
        let t_b = t_a + Duration::from_millis(5);
        let b_seq = step1(&mut inner, t_b); // 2
        assert_eq!(a_seq, 1);
        assert_eq!(b_seq, 2);

        // B step 3 先到，写入新结果
        apply_refresh_result_locked(
            &mut inner,
            b_seq,
            t_b,
            TriggerCtx::CoreReadyForceRefresh,
            Ok(Some("utun-new".into())),
        );
        assert!(matches!(&inner.state, SelfTunState::Known(n) if n == "utun-new"));

        // A step 3 后到，带的是旧结果；必须被 seq 校验丢弃
        apply_refresh_result_locked(
            &mut inner,
            a_seq,
            t_a,
            TriggerCtx::LazyRetry,
            Ok(Some("utun-old".into())),
        );
        assert!(
            matches!(&inner.state, SelfTunState::Known(n) if n == "utun-new"),
            "stale A must not overwrite newer B"
        );
    }

    #[test]
    fn apply_ok_some_from_unavailable_transitions_to_known() {
        let mut inner = fresh_inner();
        inner.state = SelfTunState::Unavailable;
        let now = Instant::now();
        let seq = step1(&mut inner, now);
        apply_refresh_result_locked(&mut inner, seq, now, TriggerCtx::LazyRetry, Ok(Some("utun5".into())));
        assert!(matches!(&inner.state, SelfTunState::Known(n) if n == "utun5"));
    }

    // 注：`for_sample` 的 "首次调用 due=true" 分支会真正调 `query_mihomo_tun_device`
    // → `Handle::mihomo()`，后者在测试环境下因 `APP_HANDLE` 未设置会 panic，单测里
    // 无法 cover。该分支的正确性由 `query_mihomo_tun_device` 单独行为 + 下面两个
    // throttle 测试覆盖的 due 判定逻辑间接担保；生产代码路径通过 `on_core_ready`
    // / `on_host_config_reload` / startup spawn 自然激活。

    #[tokio::test]
    async fn for_sample_throttles_subsequent_calls_within_retry_window() {
        let filter = SelfTunFilter::new();
        // 手动把 state 设为 Unavailable + last_attempt=now
        {
            let mut g = filter.inner.lock().await;
            g.state = SelfTunState::Unavailable;
            g.last_attempt = Some(Instant::now());
        }
        let before = filter.inner.lock().await.last_attempt;
        // 紧接着再调 for_sample，应当不 due（LAZY_RETRY_UNAVAILABLE = 60s 没过）
        let _snap = filter.for_sample().await;
        let after = filter.inner.lock().await.last_attempt;
        assert_eq!(before, after, "last_attempt should NOT update when not due");
    }

    #[tokio::test]
    async fn for_sample_known_state_uses_longer_refresh_interval() {
        let filter = SelfTunFilter::new();
        // Known 状态 + last_attempt=61s 前（超过 Unavailable 的 60s 但小于 Known 的 300s）
        {
            let mut g = filter.inner.lock().await;
            g.state = SelfTunState::Known("utun3".into());
            g.last_attempt = Some(Instant::now() - Duration::from_secs(61));
        }
        let before = filter.inner.lock().await.last_attempt;
        let _snap = filter.for_sample().await;
        let after = filter.inner.lock().await.last_attempt;
        assert_eq!(
            before, after,
            "Known state should NOT refresh at 61s (window is 300s, not 60s)"
        );
    }
}

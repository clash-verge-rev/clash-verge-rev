//! netmon 主循环：接收触发事件 → 去抖 → 采样 → 推送 mihomo。

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use clash_verge_logging::{Type, logging};
use tokio::{
    sync::{Mutex, mpsc},
    time::{Instant, timeout},
};

use super::{
    MIHOMO_HTTP_TIMEOUT, TriggerReason, fingerprint, pusher,
    pusher::ContextPusher,
    sampler::{Sample, Sampler, collect_and_build},
    self_tun_filter::SelfTunFilter,
};
use crate::core::handle::Handle;

/// 是否启用虚拟桥上报的 placeholder，恒 `false`。后续 commit 引入
/// `IVerge::enable_virtual_iface_reporting` 字段后会替换为 per-sample 读取。
const ENABLE_VIRTUAL_DEFAULT: bool = false;

/// UI 通知钩子：转发 netmon 的最新决策到前端。走 `Handle::notify_network_context_updated`
/// 发出 `verge://network-context-updated` 事件，前端诊断面板订阅此事件即可刷新。
fn notify_ui(matched: Option<&str>) {
    Handle::notify_network_context_updated(matched);
}

/// 事件去抖窗口 3 秒，合并 Wi-Fi 抖动 / 插拔网线 onLost+onAvailable 的事件风暴。
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(3000);

/// Startup / CoreReady 的 force PUT 重试参数：启动期或核心刚重启时 REST endpoint
/// 可能尚未就绪（连接拒绝）或 manager 未初始化（503），短退避几次比放弃更稳。
/// 普通网络事件失败只 log，等下次事件即可。
///
/// 4 attempts → 3 次退避 sleep（200ms / 400ms / 800ms），总退避 ≤ 1.4s。
const FORCE_PUT_ATTEMPTS: u32 = 4;
const FORCE_PUT_INITIAL_DELAY: Duration = Duration::from_millis(200);
const FORCE_PUT_MAX_DELAY: Duration = Duration::from_secs(2);

// 单次 PUT HTTP 硬上界从 mod.rs::MIHOMO_HTTP_TIMEOUT 导入，与 content_matched_delete
// 的 get_status/delete timeout 共用同一常量，保持 SHUTDOWN_TIMEOUT 预算推导准确。

pub async fn run(
    mut rx: mpsc::UnboundedReceiver<TriggerReason>,
    sampler: Arc<dyn Sampler>,
    pusher: Arc<dyn ContextPusher>,
    self_tun: Arc<SelfTunFilter>,
    stopping: Arc<AtomicBool>,
    last_pushed_fingerprint: Arc<Mutex<Option<String>>>,
    op_lock: Arc<Mutex<()>>,
) {
    while let Some(trigger) = debounce_next(&mut rx, DEBOUNCE_WINDOW).await {
        // 去抖窗口期内如果 stop_with_delete 被触发，立即停止派发，避免 final DELETE 后
        // 排队中的事件把 ctx 推回去。更严格的二次检查在 process() 内部、持锁后再做一次。
        if stopping.load(Ordering::Acquire) {
            logging!(debug, Type::Network, "netmon stopping, skip trigger={:?}", trigger);
            continue;
        }
        process(
            trigger,
            sampler.as_ref(),
            pusher.as_ref(),
            self_tun.as_ref(),
            stopping.as_ref(),
            last_pushed_fingerprint.as_ref(),
            op_lock.as_ref(),
        )
        .await;
    }

    logging!(debug, Type::Network, "netmon service loop channel closed, exit");
}

/// 去抖合并后的聚合触发：`last` 用作日志/调试显示，`force_put` 代表窗口内是否
/// 出现过任何 force 类触发（`Startup` / `CoreReady`）。这样 `CoreReady` 后紧接
/// 一个普通 `NetworkEvent` 时，force 语义不会被"只保留最后 reason"的合并吃掉。
#[derive(Debug, Clone, Copy)]
struct DebouncedTrigger {
    last: TriggerReason,
    force_put: bool,
}

/// 等待下一批事件，合并去抖窗口内的连续事件。窗口从首事件起算固定长度，
/// 不因后续事件延长（即非 trailing-edge reset）。`last` 保留最后一个 reason
/// 仅用于日志；`force_put` 对窗口内任一 force 触发做 OR 聚合。
/// 通道关闭时返回 `None`（loop 退出）。
async fn debounce_next(rx: &mut mpsc::UnboundedReceiver<TriggerReason>, window: Duration) -> Option<DebouncedTrigger> {
    let first = rx.recv().await?;
    let deadline = Instant::now() + window;
    let mut last = first;
    let mut force_put = first.force_put();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Some(DebouncedTrigger { last, force_put });
        }
        match timeout(remaining, rx.recv()).await {
            Ok(Some(r)) => {
                last = r;
                force_put |= r.force_put();
            }
            Ok(None) | Err(_) => return Some(DebouncedTrigger { last, force_put }),
        }
    }
}

async fn process(
    trigger: DebouncedTrigger,
    sampler: &dyn Sampler,
    pusher: &dyn ContextPusher,
    self_tun: &SelfTunFilter,
    stopping: &AtomicBool,
    last_pushed_fingerprint: &Mutex<Option<String>>,
    op_lock: &Mutex<()>,
) {
    // Early stopping check：`trigger()` 的 `stopping.load` check-and-send 不是原子
    // 的——TOCTOU 窗口内可能有事件已入队（例如 Resumed、platform NetworkEvent）
    // 但 shutdown 已启动。若不在此处兜底，下面 `self_tun.for_sample()` 会白跑一
    // 次 HTTP GET `/configs`，macOS 还可能触发 CoreLocation 查询——纯浪费且污染
    // shutdown 日志。`op_lock` 下的二次检查保护的是 PUT/DELETE 的幂等性，这里
    // 是早期 fast-path。
    if stopping.load(Ordering::Acquire) {
        return;
    }

    logging!(
        info,
        Type::Network,
        "netmon triggered: reason={:?}, force={}",
        trigger.last,
        trigger.force_put
    );

    // `self_tun.for_sample()` 走的是网络 I/O（可能触发 HTTP refresh）且持有内部锁，
    // 放在 `collect_and_build` 之外调用让后者保持纯数据转换（方便 mock 测试）。
    // 代价：sampler 随后返回 Unknown / Err 时本次 refresh 是"白跑"——由 60s/300s
    // 节流窗兜底，每窗口至多一次冗余 GET，换得 collect_and_build 的纯函数可测性。
    let self_tun_snap = self_tun.for_sample().await;
    let sample = match collect_and_build(sampler, self_tun_snap, ENABLE_VIRTUAL_DEFAULT).await {
        Ok(s) => s,
        Err(e) => {
            logging!(warn, Type::Network, "netmon sampler failed: {:?}", e);
            return;
        }
    };

    match sample {
        Sample::Unknown => {
            // 采集硬失败或 StubSampler —— 保留上次 ctx，不动 mihomo state
            logging!(debug, Type::Network, "netmon sampler returned Unknown, skip");
        }
        Sample::Online(ctx) => {
            logging!(
                info,
                Type::Network,
                "netmon sampled: {} interfaces [{}]; dns_suffix=[{}]",
                ctx.interfaces.len(),
                format_interfaces(&ctx.interfaces),
                ctx.dns_suffix.as_deref().map(|v| v.join(",")).unwrap_or_default(),
            );
            let fp = fingerprint::compute(&ctx);
            let force = trigger.force_put;
            // Startup / CoreReady 必须绕过 fingerprint skip：mihomo 刚启动 / 刚重启时
            // 内核侧的 /network/context 已清空，而本进程的 last_fingerprint 还是旧的，
            // 若此时网络没变我们会误判为"与上次相同"而跳过，network-policy 从此失效。
            //
            // **Single-writer 假设**（见 mod.rs 顶 "Single-writer 假设" 章节）：
            // 本分支只看本地 `last_pushed_fingerprint`，**不核对 mihomo 远端 ctx**。
            // 多 client 场景下（脚本 / 第二台 CVR）如果第三方把 mihomo 的 ctx 改成
            // 了不同内容，本进程采到相同 ctx 会跳过 PUT，mihomo 会继续带着第三方
            // 推的 ctx。Multi-client 安全需 mihomo 侧 etag / owner token（跨项目
            // backlog），本模块当前按 CVR 是唯一 host 假设工作。
            if !force {
                let cached = last_pushed_fingerprint.lock().await.clone();
                if cached.as_deref() == Some(fp.as_str()) {
                    logging!(debug, Type::Network, "netmon context unchanged, skip PUT (fp={})", fp);
                    return;
                }
            }
            // 持锁并二次检查 stopping：stop_with_delete 可能已获锁发了 final DELETE。
            let _guard = op_lock.lock().await;
            if stopping.load(Ordering::Acquire) {
                return;
            }
            let put_result = if force {
                put_with_retry(pusher, &ctx, stopping).await
            } else {
                put_once_with_timeout(pusher, &ctx).await
            };
            match put_result {
                Ok(resp) => {
                    logging!(
                        info,
                        Type::Network,
                        "netmon pushed context: matched={}, applied=[{}]",
                        resp.matched_network.as_deref().unwrap_or("<none>"),
                        format_applied(&resp.applied),
                    );
                    *last_pushed_fingerprint.lock().await = Some(fp);
                    notify_ui(resp.matched_network.as_deref());
                }
                Err(e) => log_push_error("put", &e),
            }
        }
    }
}

/// 统一给 PUT / DELETE 错误分日志级。按 `PutErrorKind` 分类（见 pusher.rs 模块
/// doc 对 plugin Error API 的限制说明）。
///
/// 注意：本函数**仅由 PUT 分支调用**——`stop_with_delete` 的 final DELETE
/// 走 mod.rs 里的内联 `logging!(warn, ...)`，不经过本函数。
fn log_push_error(op: &'static str, err: &anyhow::Error) {
    match pusher::classify_put_error(err) {
        pusher::PutErrorKind::Connect => {
            logging!(
                debug,
                Type::Network,
                "netmon {} skipped: mihomo not reachable ({:?})",
                op,
                err
            );
        }
        pusher::PutErrorKind::Timeout => {
            logging!(warn, Type::Network, "netmon {} timed out: {:?}", op, err);
        }
        pusher::PutErrorKind::FailedResponse => {
            // 升 error 级：mihomo 返回非 2xx 属于需要暴露的 push failure——可能
            // 根因包括 mihomo manager 未就绪 503（启动期 / 配置热重载期）、
            // sampler 构造的 body 触发 kernel schema 校验、CVR/mihomo 版本不匹配
            // 等。单条日志不保证根因是 CVR sampler bug，但这类错误不应和瞬时
            // timeout / connect refused 混在 warn 级被忽略。`{:?}` 沿 anyhow chain
            // 暴露 plugin `FailedResponse(String)` 的 message 原文（pusher.rs 顶
            // "已知限制" 说明 REST code 字段在 plugin 层就被丢弃，triage 只能
            // 依赖 message）。
            logging!(error, Type::Network, "netmon {} rejected by mihomo: {:?}", op, err);
        }
        pusher::PutErrorKind::Other => {
            logging!(warn, Type::Network, "netmon {} failed: {:?}", op, err);
        }
    }
}

/// 把 `interfaces[]` 汇总成一行可读日志。覆盖 mihomo 内核做 matcher 判定时会
/// 读的**全部** `InterfaceContext` 字段（name / iface_type / ssid / bssid /
/// gateway_ip / gateway_mac / subnets / metered），`None` 字段直接省略，空
/// `subnets` 也省略，避免日志被大量占位符污染。每张网卡形如
/// `<name> type=<t> ssid=<s> bssid=<b> gw_ip=<i> gw_mac=<m> subnets=[...] metered=<bool>`，
/// 多张网卡用 ` | ` 分隔。字段全部缺失时仅打印 `<name>` 本身。
fn format_interfaces(ifaces: &[tauri_plugin_mihomo::models::InterfaceContext]) -> String {
    ifaces
        .iter()
        .map(|i| {
            let mut parts = vec![i.name.clone()];
            if let Some(t) = &i.iface_type {
                parts.push(format!("type={}", t));
            }
            if let Some(s) = &i.ssid {
                parts.push(format!("ssid={}", s));
            }
            if let Some(b) = &i.bssid {
                parts.push(format!("bssid={}", b));
            }
            if let Some(ip) = &i.gateway_ip {
                parts.push(format!("gw_ip={}", ip));
            }
            if let Some(mac) = &i.gateway_mac {
                parts.push(format!("gw_mac={}", mac));
            }
            if let Some(subs) = &i.subnets
                && !subs.is_empty()
            {
                parts.push(format!("subnets=[{}]", subs.join(",")));
            }
            if let Some(m) = i.metered {
                parts.push(format!("metered={}", m));
            }
            parts.join(" ")
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

/// 把 `applied[]` 汇总成一行可读日志。每组形如
/// `<group>: <applied_proxy> (target=<t|-> reason=<r>, source=<s>, changed=<bool>)`；
/// `target_proxy` 在 `missing_target` / `already_selected` 等场景与 `applied_proxy`
/// 不同，诊断时最关键，因此显式打印。空 applied 时返回空串。
fn format_applied(applied: &[tauri_plugin_mihomo::models::AppliedGroup]) -> String {
    applied
        .iter()
        .map(|g| {
            format!(
                "{}: {} (target={}, reason={}, source={}, changed={})",
                g.group,
                g.applied_proxy,
                g.target_proxy.as_deref().unwrap_or("-"),
                g.reason,
                g.selection_source,
                g.changed
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// 单次 PUT + 硬超时，用于非 force 分支。
///
/// 本地 timeout 用 `std::io::ErrorKind::TimedOut` 构造 error 并挂进 anyhow chain，
/// 让 `classify_put_error` 能识别为 `PutErrorKind::Timeout`（与 plugin 内部 reqwest
/// timeout 的分类保持一致），日志就能准确打成 "timed out" 而不是笼统的 "failed"。
async fn put_once_with_timeout(
    pusher: &dyn ContextPusher,
    ctx: &tauri_plugin_mihomo::models::NetworkContext,
) -> anyhow::Result<tauri_plugin_mihomo::models::PutResponse> {
    match timeout(MIHOMO_HTTP_TIMEOUT, pusher.put(ctx)).await {
        Ok(result) => result,
        Err(_) => Err(anyhow::Error::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!("netmon put timed out after {:?}", MIHOMO_HTTP_TIMEOUT),
        ))),
    }
}

/// 指数退避的 PUT 重试，仅用于 force 类触发（Startup / CoreReady）。
/// 任何一次成功立即返回；attempts 耗尽返回最后一次错误；`stopping` 置位时提前退出
/// （每次 sleep 前后都检查 + 单次 PUT 有 [`MIHOMO_HTTP_TIMEOUT`] 硬上界，确保
/// `stop_with_delete` 最多等一次 PUT timeout + 一个已开始的 sleep 间隔后就能让路）。
async fn put_with_retry(
    pusher: &dyn ContextPusher,
    ctx: &tauri_plugin_mihomo::models::NetworkContext,
    stopping: &AtomicBool,
) -> anyhow::Result<tauri_plugin_mihomo::models::PutResponse> {
    let mut delay = FORCE_PUT_INITIAL_DELAY;
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..FORCE_PUT_ATTEMPTS {
        if stopping.load(Ordering::Acquire) {
            break;
        }
        match put_once_with_timeout(pusher, ctx).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                logging!(
                    debug,
                    Type::Network,
                    "netmon force PUT attempt {}/{} failed: {:?}",
                    attempt + 1,
                    FORCE_PUT_ATTEMPTS,
                    e
                );
                last_err = Some(e);
            }
        }
        if attempt + 1 == FORCE_PUT_ATTEMPTS {
            break;
        }
        if stopping.load(Ordering::Acquire) {
            break;
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(FORCE_PUT_MAX_DELAY);
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("put_with_retry: no attempts made")))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use tokio::time::sleep;

    const TEST_WINDOW: Duration = Duration::from_millis(150);

    #[tokio::test]
    async fn debounce_coalesces_burst_into_last_event() {
        let (tx, mut rx) = mpsc::unbounded_channel();

        // 连发 5 个事件，最后是 Resumed
        tx.send(TriggerReason::Startup).unwrap();
        tx.send(TriggerReason::NetworkEvent).unwrap();
        tx.send(TriggerReason::NetworkEvent).unwrap();
        tx.send(TriggerReason::Manual).unwrap();
        tx.send(TriggerReason::Resumed).unwrap();

        let trigger = debounce_next(&mut rx, TEST_WINDOW).await.unwrap();
        assert!(matches!(trigger.last, TriggerReason::Resumed));
        // Startup 在窗口内出现过 → force_put OR 聚合后仍为 true，即使 last 是非 force reason
        assert!(trigger.force_put, "force_put should survive via OR-aggregation");
    }

    #[tokio::test]
    async fn debounce_force_put_survives_non_force_last() {
        // CoreReady 后紧跟一个普通 NetworkEvent：force_put 必须不被吃掉
        let (tx, mut rx) = mpsc::unbounded_channel();
        tx.send(TriggerReason::CoreReady).unwrap();
        tx.send(TriggerReason::NetworkEvent).unwrap();

        let trigger = debounce_next(&mut rx, TEST_WINDOW).await.unwrap();
        assert!(matches!(trigger.last, TriggerReason::NetworkEvent));
        assert!(trigger.force_put);
    }

    #[tokio::test]
    async fn debounce_no_force_when_only_network_events() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tx.send(TriggerReason::NetworkEvent).unwrap();
        tx.send(TriggerReason::NetworkEvent).unwrap();

        let trigger = debounce_next(&mut rx, TEST_WINDOW).await.unwrap();
        assert!(!trigger.force_put);
    }

    #[tokio::test]
    async fn debounce_waits_full_window_after_last_event() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tx_sender = tx.clone();

        tokio::spawn(async move {
            tx_sender.send(TriggerReason::NetworkEvent).unwrap();
            sleep(Duration::from_millis(50)).await;
            tx_sender.send(TriggerReason::NetworkEvent).unwrap();
            sleep(Duration::from_millis(50)).await;
            tx_sender.send(TriggerReason::NetworkEvent).unwrap();
        });

        let start = Instant::now();
        let trigger = debounce_next(&mut rx, TEST_WINDOW).await.unwrap();
        let elapsed = start.elapsed();

        assert!(matches!(trigger.last, TriggerReason::NetworkEvent));
        // 窗口从第一个事件起算 150ms，中间事件只重置 last、不延长 deadline
        assert!(elapsed >= Duration::from_millis(140), "elapsed = {:?}", elapsed);
        assert!(elapsed < Duration::from_millis(300), "elapsed = {:?}", elapsed);
    }

    #[tokio::test]
    async fn debounce_returns_none_when_channel_closes_empty() {
        let (tx, mut rx) = mpsc::unbounded_channel::<TriggerReason>();
        drop(tx);
        assert!(debounce_next(&mut rx, TEST_WINDOW).await.is_none());
    }
}

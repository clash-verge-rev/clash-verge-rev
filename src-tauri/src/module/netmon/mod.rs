//! 网络监听（netmon）模块。
//!
//! 订阅 OS 网络事件 + 电源事件，采集当前 `NetworkContext`，通过 mihomo plugin 的
//! `PUT /network/context` 把"当前所处的网络"告知内核，让 `network-policy` 代理组
//! 跟随环境自动切换。
//!
//! - 事件驱动 + resume hook 补推，不带 ttl（sticky 模式）
//! - 去抖窗口 3 秒，合并 Wi-Fi 抖动 / 插拔网线 onLost+onAvailable
//! - 指纹比对跳过重复 PUT（内核也有幂等，这是本地优化）
//! - 退出路径发 best-effort **content-match** DELETE：mihomo 当前 ctx 的 fingerprint
//!   与本进程 last_pushed_fingerprint 相等时才 DELETE。相等只证明内容相同，
//!   **不证明最后写入者是本进程**（见下方 "Single-writer 假设"）
//!
//! ## 并发契约
//!
//! 所有对 mihomo 的 PUT / DELETE（包括 exit 路径的 final DELETE）必须持有 `op_lock`。
//! 这样即使 service loop 正在 in-flight PUT，`stop_with_delete` 也会排在它后面执行，
//! 保证 final DELETE 的"清除本会话 ctx"语义不被回推覆盖。`stopping` 标志在锁内
//! 二次检查，持锁前排队的 PUT 会看到 stopping=true 主动放弃。
//!
//! ## Single-writer 假设（multi-client 已知限制）
//!
//! 本模块的 **owner / ctx 归属判定依赖本地 `last_pushed_fingerprint` 与 mihomo
//! 当前 ctx 的 fingerprint 相等**。这只能证明"mihomo 当前 ctx 的**内容**与本进程
//! 最后一次成功 PUT 的内容相同"，**不能**证明"最后一个写入者是本进程"——另一个
//! host（headless 脚本 / systemd unit / 第二台 CVR）完全可能在本进程之后推了
//! 内容相同的 ctx。CVR 的 shutdown DELETE 在这种场景下会误删对方的 ctx。
//!
//! 真正的 multi-client 安全需要 mihomo 侧提供 owner token / etag /
//! compare-and-delete 语义（跨项目 backlog）。CVR 当前按 **single-writer** 假设工作：在一个桌面环境里
//! CVR 是唯一 host；headless 场景下用户自行协调不同客户端。service loop 的非 force
//! fingerprint-skip 也建立在同一假设上（见 service.rs::process 里的注释）。

mod fingerprint;
mod platform;
mod pusher;
mod sampler;
mod self_tun_filter;
mod service;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::Result;
use clash_verge_logging::{Type, logging};
use once_cell::sync::OnceCell;
use tokio::sync::{Mutex, mpsc};
use tokio::time::timeout;

use crate::process::AsyncHandler;
use platform::{PlatformMonitor, new_platform_monitor, new_sampler};
use pusher::{ContextPusher, MihomoPusher};
use sampler::Sampler;

/// 触发 netmon 重采 + 推送的原因。
#[derive(Debug, Clone, Copy)]
pub enum TriggerReason {
    /// 应用启动首次推送
    Startup,
    /// 系统 resume（从 sleep 唤醒）或 app 从后台切前台
    #[allow(dead_code)] // 由 RunEvent::Resumed hook 消费，骨架阶段尚未接入
    Resumed,
    /// mihomo 核心 start / restart / change 成功后：本进程内的 fingerprint 还是
    /// 旧的，但 mihomo 侧的 /network/context 已被重置，需要强制重推一次，
    /// 否则在"网络没变 + 核心刚重启"时 network-policy 永远不会生效
    #[allow(dead_code)] // 由 lifecycle.rs::start_core 成功后调用，骨架阶段尚未接入
    CoreReady,
    /// 平台原生事件（netlink / NotifyIpInterfaceChange / SCDynamicStore）
    #[allow(dead_code)] // 真实 platform monitor 构造；StubMonitor 下不触发
    NetworkEvent,
    /// 手动触发：resume hook / 前端命令 / on_host_config_reload 都走这条
    #[allow(dead_code)] // trigger() 消费，骨架阶段尚未接入
    Manual,
}

impl TriggerReason {
    /// "强制"类触发：必须绕过本地 fingerprint 跳过、PUT 失败走 bounded retry。
    /// Startup / CoreReady 对应 mihomo 侧 /network/context 状态被重置的时机。
    pub(crate) const fn force_put(self) -> bool {
        matches!(self, Self::Startup | Self::CoreReady)
    }
}

struct NetmonHandle {
    tx: mpsc::UnboundedSender<TriggerReason>,
    monitor: Arc<dyn PlatformMonitor>,
    /// 所有 PUT/DELETE 走同一个 `ContextPusher` trait 实例（exit 路径也不例外）。
    /// 这样 `stop_with_delete` 的 GET-compare-DELETE 时序也能被单测 mock。
    pusher: Arc<dyn ContextPusher>,
    /// `stop_with_delete` 后置为 true：
    /// - `trigger()` 据此拒绝派发新事件
    /// - service loop 外层据此跳过已排队事件
    /// - service::process 据此在持锁后放弃对 mihomo 的 PUT/DELETE
    stopping: Arc<AtomicBool>,
    /// 上一次**成功 PUT** 写入的 fingerprint（service loop 内成功 PUT 后更新）。
    /// `None` 表示本进程未成功 PUT 过；`Some(fp)` 表示本进程最后推的 ctx 指纹。
    /// `stop_with_delete` 用这个字段与 `GET /network/context` 的当前 ctx 指纹比对：
    /// 相等 → 发 final DELETE；不等 → 说明 mihomo 的 ctx **内容** 已变（最常见的是
    /// 别的 client 推了不同 ctx），跳过 DELETE。**Best-effort：相等也可能是
    /// 别的 client 推了相同内容，见 mod.rs 顶 "Single-writer 假设"**。
    last_pushed_fingerprint: Arc<Mutex<Option<String>>>,
    /// 串行化所有对 mihomo 的 PUT / DELETE / GET；见模块级 "并发契约" 注释。
    op_lock: Arc<Mutex<()>>,
}

static HANDLE: OnceCell<NetmonHandle> = OnceCell::new();

/// 是否采集 Wi-Fi SSID/BSSID 并上报给内核。由 verge config
/// `enable_wifi_detection` 驱动，启动时由 `lib.rs::setup` 从配置初始化 atomic，
/// 前端改动后由 `feat/config.rs` 的 `UpdateFlags::WIFI_DETECTION_SYNC` 同步。
/// sampler 每次采样前读一次（原子 load），决定是否调 `wifi::read_wifi_info`。
///
/// **默认 false**（三平台统一）：开启可能带来 PII / 隐私成本（macOS CoreLocation
/// 授权、Wi-Fi API 授权），统一保守默认。骨架阶段 atomic 直接取常量值，
/// 外部同步链路（`IVerge` 字段 + `UpdateFlags::WIFI_DETECTION_SYNC`）由后续 commit 接入。
static WIFI_DETECTION_ENABLED: AtomicBool = AtomicBool::new(DEFAULT_WIFI_DETECTION);

/// 平台默认值——三平台统一为 `false`（隐私优先）。
pub(crate) const DEFAULT_WIFI_DETECTION: bool = false;

/// mihomo 单次 HTTP 调用的硬上界。三处复用：
/// - `service.rs::put_once_with_timeout` 包 PUT
/// - `content_matched_delete` 内包 `get_status` 和 `delete`
///
/// 共用一个常量让 `SHUTDOWN_TIMEOUT = 3 × MIHOMO_HTTP_TIMEOUT` 的预算推导
/// 始终准确。
pub(super) const MIHOMO_HTTP_TIMEOUT: Duration = Duration::from_secs(3);

/// `stop_with_delete` 整条退出路径的上界超时（见函数文档）。
///
/// 值选定 `9s = 3 × MIHOMO_HTTP_TIMEOUT`——三次连续 mihomo HTTP 的 worst-case：
/// - **worst-case 等锁 ≤ 3s**：`stop_with_delete` 触发时 service loop 正在做一次
///   force PUT attempt，in-flight HTTP 无法中断，必须等 `MIHOMO_HTTP_TIMEOUT` 触发
///   才释放 `op_lock`
/// - **释放锁后 `get_status` ≤ 3s**：`content_matched_delete` 内用
///   `tokio::time::timeout(MIHOMO_HTTP_TIMEOUT, ...)` 显式包裹 GET
/// - **GET 匹配后 `delete` ≤ 3s**：同理显式包 DELETE
///
/// 常规（健康 mihomo）场景下三次 HTTP 远小于各自 3s；本 timeout 只在 mihomo
/// 挂死时触发，此时 warn + 放弃 final DELETE。
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(9);

/// `monitor.stop()` 的独立超时。三平台的真实 monitor 停机包含：
/// - Linux：`drop` rtnetlink multicast socket、signal netlink listen task
/// - macOS：CFRunLoopStop + 等 runloop 线程 join
/// - Windows：`CancelMibChangeNotify2` ×2、`WlanRegisterNotification(SOURCE_NONE)`，
///   三者都阻塞到 in-flight callback 返回
///
/// 健康场景下这些都是毫秒级；极端情况下（OS 内部死锁 / wgservice 挂死）需要
/// 一个独立上限防止拖住 app 退出。3s 同 `MIHOMO_HTTP_TIMEOUT`，在 wall-clock
/// 上足以覆盖正常 drain，又远小于用户感知的"关不掉"阈值。超时后 warn log，
/// 让进程继续退出——此时 monitor 的回调可能仍在 in-flight，但本进程即将结束、
/// OS 会回收所有 file handle 与内存，属于可接受降级（见 Windows monitor.rs 顶
/// "MonitorState UAF 防御" 说明：cancel 超时不会引入额外 UAF 风险，只是放弃
/// 等待 cancel 返回确认）。
const MONITOR_STOP_TIMEOUT: Duration = Duration::from_secs(3);

#[allow(dead_code)] // 由 lib.rs::setup 与 UpdateFlags::WIFI_DETECTION_SYNC 调用
pub(crate) fn set_wifi_detection_enabled(enabled: bool) {
    WIFI_DETECTION_ENABLED.store(enabled, Ordering::Release);
}

#[allow(dead_code)] // 由平台 wifi 模块在采样时读取
pub(crate) fn wifi_detection_enabled() -> bool {
    WIFI_DETECTION_ENABLED.load(Ordering::Acquire)
}

/// 启动 netmon：spawn service loop + 平台事件订阅 + 发送首次 Startup 触发。
///
/// 幂等（二次调用直接返回 Ok）。由 `lib.rs::setup` 末尾调用。
/// service loop 本身不主动退出——依赖进程终止时 tokio runtime 回收；
/// `stop_with_delete` 通过 `stopping` 标志让 service::process 拒绝继续推送，
/// 实现"软停止"语义。
#[allow(dead_code, clippy::unnecessary_wraps)] // 调用方 lib.rs::setup 骨架阶段尚未接入
pub fn start() -> Result<()> {
    if HANDLE.get().is_some() {
        return Ok(());
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let monitor = new_platform_monitor();
    let sampler: Arc<dyn Sampler> = new_sampler();
    let pusher: Arc<dyn ContextPusher> = Arc::new(MihomoPusher);
    let stopping = Arc::new(AtomicBool::new(false));
    let last_pushed_fingerprint: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let op_lock = Arc::new(Mutex::new(()));

    if HANDLE
        .set(NetmonHandle {
            tx: tx.clone(),
            monitor: Arc::clone(&monitor),
            pusher: Arc::clone(&pusher),
            stopping: Arc::clone(&stopping),
            last_pushed_fingerprint: Arc::clone(&last_pushed_fingerprint),
            op_lock: Arc::clone(&op_lock),
        })
        .is_err()
    {
        logging!(debug, Type::Network, "netmon::start lost HANDLE race, nothing to do");
        return Ok(());
    }

    // service loop
    let service_stopping = Arc::clone(&stopping);
    let service_fp = Arc::clone(&last_pushed_fingerprint);
    let service_lock = Arc::clone(&op_lock);
    AsyncHandler::spawn(move || async move {
        service::run(rx, sampler, pusher, service_stopping, service_fp, service_lock).await;
    });

    // 平台事件订阅
    let monitor_start_tx = tx.clone();
    AsyncHandler::spawn(move || async move {
        if let Err(e) = monitor.start(monitor_start_tx).await {
            logging!(warn, Type::Network, "netmon platform monitor start failed: {:?}", e);
        }
    });

    // 首次推送
    let _ = tx.send(TriggerReason::Startup);
    logging!(info, Type::Network, "netmon started");
    Ok(())
}

/// 手动触发一次重采（resume hook / 前端命令 / on_host_config_reload 都走这条）。
/// netmon 未启动或已进入 stopping 状态时是 no-op。
#[allow(dead_code)] // 调用方（resume hook / lifecycle / cmd）骨架阶段尚未接入
pub fn trigger(reason: TriggerReason) {
    if let Some(h) = HANDLE.get() {
        if h.stopping.load(Ordering::Acquire) {
            return;
        }
        let _ = h.tx.send(reason);
    }
}

/// `content_matched_delete` 的结果：用 enum 而非 bool + Option 便于单测精确断言。
#[derive(Debug)]
enum FinalDeleteOutcome {
    /// 本进程从未成功 PUT 过 —— 不用发 DELETE
    NeverPushed,
    /// GET 成功 + fingerprint 内容匹配 + DELETE 成功。**注意**：内容匹配不等于
    /// "本进程是最后写入者"；见 mod.rs 顶 "Single-writer 假设" 及本模块单测
    /// `same_content_from_other_client_would_still_delete`
    Deleted,
    /// GET 成功但 fingerprint 内容不匹配 —— mihomo 的 ctx 已变（最常见：别的 client
    /// 推了不同内容，或 TTL 已过期使 `context=null`），跳过 DELETE
    ContentMismatch,
    /// GET 失败（mihomo 已退 / 连接拒绝）—— 保守跳过 DELETE
    GetStatusFailed(anyhow::Error),
    /// GET 匹配后 DELETE 失败（mihomo 中途挂 / 5xx）
    DeleteFailed(anyhow::Error),
}

/// 基于 fingerprint **内容**匹配的 final DELETE 纯业务逻辑（抽取出来便于 mock 单测）。
///
/// **语义限定**：本函数做的是 "best-effort content-match delete"，**不是**
/// multi-client-safe 的 ownership verification。fingerprint 相等只证明 mihomo 当前
/// ctx 的内容与本进程最后成功 PUT 的内容相同；若另一 client 在本进程之后推了
/// 内容相同的 ctx，本函数仍会返回 `Deleted`（即误删对方 ctx）。真正的 multi-client
/// safety 需 mihomo 提供 owner token / CAS API（跨项目 backlog）。见 mod.rs 顶
/// "Single-writer 假设"章节。
///
/// 流程：
/// 1. 读 `last_pushed_fingerprint` —— 若本进程从未 PUT 过直接返回 `NeverPushed`
/// 2. 调 `pusher.get_status()`（包 [`MIHOMO_HTTP_TIMEOUT`]）读 mihomo 当前 `/network/context`
/// 3. 计算当前 ctx 的 fingerprint，与 `last_pushed_fingerprint` 比对
/// 4. 相等 → 调 `pusher.delete()`（包 [`MIHOMO_HTTP_TIMEOUT`]）；不等 → `ContentMismatch`
async fn content_matched_delete(
    pusher: &dyn ContextPusher,
    last_pushed_fingerprint: &Mutex<Option<String>>,
) -> FinalDeleteOutcome {
    let Some(expected_fp) = last_pushed_fingerprint.lock().await.clone() else {
        return FinalDeleteOutcome::NeverPushed;
    };
    let status = match timeout(MIHOMO_HTTP_TIMEOUT, pusher.get_status()).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return FinalDeleteOutcome::GetStatusFailed(e),
        Err(_) => {
            return FinalDeleteOutcome::GetStatusFailed(anyhow::Error::from(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("netmon get_status timed out after {:?}", MIHOMO_HTTP_TIMEOUT),
            )));
        }
    };
    let current_fp = status.context.as_ref().map(fingerprint::compute);
    if current_fp.as_deref() != Some(expected_fp.as_str()) {
        return FinalDeleteOutcome::ContentMismatch;
    }
    match timeout(MIHOMO_HTTP_TIMEOUT, pusher.delete()).await {
        Ok(Ok(())) => {
            *last_pushed_fingerprint.lock().await = None;
            FinalDeleteOutcome::Deleted
        }
        Ok(Err(e)) => FinalDeleteOutcome::DeleteFailed(e),
        Err(_) => FinalDeleteOutcome::DeleteFailed(anyhow::Error::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!("netmon delete timed out after {:?}", MIHOMO_HTTP_TIMEOUT),
        ))),
    }
}

/// 关闭平台订阅并（按需）发 DELETE 清除 sticky 上下文。exit 路径用。
///
/// 执行顺序：
/// 1. 置 `stopping=true`：`trigger()` 立即拒绝派发新事件
/// 2. 获取 `op_lock`：等待 service 中任何 in-flight PUT/DELETE 完成后再继续
/// 3. `content_matched_delete`：见该函数文档——若 mihomo 当前 ctx 的 fingerprint
///    与本进程最后推的相等，发 DELETE；否则跳过。**best-effort，不保证
///    multi-client safe**（见 mod.rs 顶"Single-writer 假设"）
/// 4. 释放锁，最后调 `monitor.stop()`（best-effort，与 mihomo 无关），单独包
///    `MONITOR_STOP_TIMEOUT`——三平台真实 monitor 的 drain 逻辑若卡住（OS 内部
///    死锁 / wgservice 挂死）不拖住 app 退出。超时 warn，放弃等 cancel 返回
///    确认（可接受降级，见 MONITOR_STOP_TIMEOUT 常量注释）。
///
/// 整条 3.1–3.x 路径包一层 `tokio::time::timeout(SHUTDOWN_TIMEOUT)`——mihomo 挂死 /
/// HTTP 阻塞不会拖住 app shutdown，超时就 warn+放弃 DELETE。
#[allow(dead_code)] // 由 feat/window.rs::clean_async 调用，骨架阶段尚未接入
pub async fn stop_with_delete() {
    let Some(h) = HANDLE.get() else { return };
    h.stopping.store(true, Ordering::Release);

    let timeout_result = timeout(SHUTDOWN_TIMEOUT, async {
        let _guard = h.op_lock.lock().await;
        let outcome = content_matched_delete(h.pusher.as_ref(), h.last_pushed_fingerprint.as_ref()).await;
        match outcome {
            FinalDeleteOutcome::NeverPushed => logging!(
                debug,
                Type::Network,
                "netmon exit: never successfully pushed, skipping final DELETE"
            ),
            FinalDeleteOutcome::Deleted => {
                logging!(info, Type::Network, "netmon sent final DELETE on exit")
            }
            FinalDeleteOutcome::ContentMismatch => logging!(
                info,
                Type::Network,
                "netmon exit: mihomo ctx content differs from last pushed (fp mismatch), skipping final DELETE"
            ),
            FinalDeleteOutcome::GetStatusFailed(e) => logging!(
                warn,
                Type::Network,
                "netmon exit: get_status failed, skipping final DELETE: {:?}",
                e
            ),
            FinalDeleteOutcome::DeleteFailed(e) => logging!(
                warn,
                Type::Network,
                "netmon final delete network context failed: {:?}",
                e
            ),
        }
    })
    .await;

    if timeout_result.is_err() {
        logging!(
            warn,
            Type::Network,
            "netmon stop_with_delete timed out after {:?}, abandoning final DELETE",
            SHUTDOWN_TIMEOUT
        );
    }

    if timeout(MONITOR_STOP_TIMEOUT, h.monitor.stop()).await.is_err() {
        logging!(
            warn,
            Type::Network,
            "netmon monitor stop timed out after {:?}, abandoning drain and forcing detach",
            MONITOR_STOP_TIMEOUT
        );
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic, clippy::unimplemented)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use async_trait::async_trait;
    use std::sync::atomic::AtomicU32;
    use tauri_plugin_mihomo::models::{InterfaceContext, NetworkContext, NetworkStatus, PutResponse};

    struct MockPusher {
        /// 模拟 `get_status` 的返回：`Ok(status)` 或 `Err(msg)`
        get_status_result: Mutex<Option<anyhow::Result<NetworkStatus>>>,
        /// 模拟 `delete` 的返回：默认 `Ok(())`
        delete_result: Mutex<Option<anyhow::Result<()>>>,
        /// `delete` 实际被调用次数
        delete_calls: AtomicU32,
    }

    impl MockPusher {
        fn new_with(get_status: anyhow::Result<NetworkStatus>) -> Self {
            Self {
                get_status_result: Mutex::new(Some(get_status)),
                delete_result: Mutex::new(Some(Ok(()))),
                delete_calls: AtomicU32::new(0),
            }
        }
    }

    #[async_trait]
    impl ContextPusher for MockPusher {
        async fn put(&self, _ctx: &NetworkContext) -> anyhow::Result<PutResponse> {
            unimplemented!("not used in these tests")
        }
        async fn delete(&self) -> anyhow::Result<()> {
            self.delete_calls.fetch_add(1, Ordering::SeqCst);
            self.delete_result.lock().await.take().unwrap_or(Ok(()))
        }
        async fn get_status(&self) -> anyhow::Result<NetworkStatus> {
            self.get_status_result
                .lock()
                .await
                .take()
                .unwrap_or_else(|| Err(anyhow!("get_status mock exhausted")))
        }
    }

    fn ctx_with(ifaces: Vec<&str>) -> NetworkContext {
        NetworkContext {
            version: 1,
            interfaces: ifaces
                .into_iter()
                .map(|n| InterfaceContext {
                    name: n.to_string(),
                    iface_type: None,
                    ssid: None,
                    bssid: None,
                    gateway_ip: None,
                    gateway_mac: None,
                    subnets: None,
                    metered: None,
                })
                .collect(),
            dns_suffix: None,
            ttl: None,
        }
    }

    #[tokio::test]
    async fn never_pushed_skips_delete() {
        let pusher = MockPusher::new_with(Err(anyhow!("should not be called")));
        let fp = Mutex::new(None);
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::NeverPushed));
        assert_eq!(pusher.delete_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn matching_fingerprint_triggers_delete() {
        let ctx = ctx_with(vec!["en0"]);
        let expected_fp = fingerprint::compute(&ctx);
        let pusher = MockPusher::new_with(Ok(NetworkStatus {
            context: Some(ctx),
            matched_network: None,
            groups: Vec::new(),
            expires_at: None,
            age_seconds: None,
        }));
        let fp = Mutex::new(Some(expected_fp));
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::Deleted));
        assert_eq!(pusher.delete_calls.load(Ordering::SeqCst), 1);
        // 成功 DELETE 后 last_pushed_fingerprint 被清
        assert!(fp.lock().await.is_none());
    }

    #[tokio::test]
    async fn mismatched_fingerprint_skips_delete() {
        // mihomo 返回的 ctx 与本进程 last_pushed 不同（别的 client 覆盖过）
        let pusher = MockPusher::new_with(Ok(NetworkStatus {
            context: Some(ctx_with(vec!["other-client-iface"])),
            matched_network: None,
            groups: Vec::new(),
            expires_at: None,
            age_seconds: None,
        }));
        let fp = Mutex::new(Some("deadbeef0000cafe".to_string()));
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::ContentMismatch));
        assert_eq!(
            pusher.delete_calls.load(Ordering::SeqCst),
            0,
            "must NOT delete when fingerprint mismatches"
        );
        // fp 不清——下次启动仍可知道"上次 PUT 过"
        assert!(fp.lock().await.is_some());
    }

    #[tokio::test]
    async fn status_with_null_context_counts_as_mismatch() {
        // mihomo 内 ctx 已被 DELETE / TTL 过期，context=null
        let pusher = MockPusher::new_with(Ok(NetworkStatus {
            context: None,
            matched_network: None,
            groups: Vec::new(),
            expires_at: None,
            age_seconds: None,
        }));
        let fp = Mutex::new(Some("any-fp".to_string()));
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::ContentMismatch));
        assert_eq!(pusher.delete_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn get_status_error_skips_delete() {
        let pusher = MockPusher::new_with(Err(anyhow!("connection refused")));
        let fp = Mutex::new(Some("any-fp".to_string()));
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::GetStatusFailed(_)));
        assert_eq!(
            pusher.delete_calls.load(Ordering::SeqCst),
            0,
            "GET 失败时不能盲发 DELETE"
        );
    }

    #[tokio::test]
    async fn delete_error_reports_delete_failed() {
        let ctx = ctx_with(vec!["en0"]);
        let expected_fp = fingerprint::compute(&ctx);
        let pusher = MockPusher::new_with(Ok(NetworkStatus {
            context: Some(ctx),
            matched_network: None,
            groups: Vec::new(),
            expires_at: None,
            age_seconds: None,
        }));
        *pusher.delete_result.lock().await = Some(Err(anyhow!("mihomo 5xx")));
        let fp = Mutex::new(Some(expected_fp));
        let outcome = content_matched_delete(&pusher, &fp).await;
        assert!(matches!(outcome, FinalDeleteOutcome::DeleteFailed(_)));
        assert_eq!(pusher.delete_calls.load(Ordering::SeqCst), 1);
        // delete 失败时 fp 保留（下次有机会再试；实际场景是 shutdown 路径不会 retry）
        assert!(fp.lock().await.is_some());
    }

    /// **已知限制 / 回归测**（见 mod.rs 顶"Single-writer 假设"）：本函数做的是
    /// best-effort content-match delete，不是 multi-client-safe ownership
    /// verification。如果另一 client 在本进程之后推了**内容相同**的 ctx，本进程
    /// 退出时会基于 fingerprint 匹配执行 DELETE，误删对方的 ctx。真正的 multi-client
    /// 安全需 mihomo 提供 owner token / CAS，列为跨项目 backlog。
    ///
    /// 本测试把这个 edge case 固定下来：若未来有人改出"multi-client safe" 语义，
    /// 此测试会失败，迫使其同时更新 mod.rs 顶的 Single-writer 假设注释与 backlog。
    #[tokio::test]
    async fn same_content_from_other_client_would_still_delete() {
        // 假想时序：
        //   t1  本进程 PUT ctx=A → last_pushed_fingerprint = fp(A)
        //   t2  别的 client 也 PUT 了**内容相同**的 ctx=A（另一个 writer）
        //   t3  本进程退出，GET /network/context 返回仍是 ctx=A
        //   t4  content_matched_delete: current_fp == expected_fp → Deleted
        //       → 本进程把对方的 ctx 删掉了（误删）
        let ctx = ctx_with(vec!["en0"]);
        let expected_fp = fingerprint::compute(&ctx);
        let pusher = MockPusher::new_with(Ok(NetworkStatus {
            context: Some(ctx),
            matched_network: None,
            groups: Vec::new(),
            expires_at: None,
            age_seconds: None,
        }));
        let fp = Mutex::new(Some(expected_fp));
        let outcome = content_matched_delete(&pusher, &fp).await;
        // 当前语义：Deleted（不是 ContentMismatch）——把这个行为钉死，作为已知限制的回归测
        assert!(matches!(outcome, FinalDeleteOutcome::Deleted));
        assert_eq!(pusher.delete_calls.load(Ordering::SeqCst), 1);
    }
}

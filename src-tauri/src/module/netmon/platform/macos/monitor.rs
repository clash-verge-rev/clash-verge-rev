//! macOS PlatformMonitor：SCDynamicStore + 独立 pthread 跑 CFRunLoop。
//!
//! 订阅 `State:/Network/Global/IPv4|IPv6` +
//! `State:/Network/Interface/*/IPv4|IPv6|Link|AirPort`，callback 在 run loop
//! 线程执行，仅做原子 check + 非阻塞 channel send。AirPort 一路是为了覆盖
//! 同卡 SSID 切换（IPv4/Link 在同子网 SSID 切换时可能不变）。
//!
//! 关闭顺序（fail-closed）：
//! 1. `stopping = true`
//! 2. `CFRunLoopStop(saved_run_loop)` 唤醒 run loop
//! 3. run loop 线程循环体检测到 `stopping` 后退出；store / source / callback context
//!    随 thread scope 退出而 Drop（Drop 由 SCDynamicStoreBuilder::callback_context 托管）
//! 4. `thread.join()` 确认 thread 退出；之后保证不会再有 callback 解引用我们的 tx
//!
//! 为避免 "start 后 stop 发生在 CFRunLoopRun 进入前" 的竞态，thread 体使用
//! `run_in_mode` 短循环 + stopping 检查，而不是单次 `run_current()`。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context as _, Result};
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use core_foundation::array::CFArray;
use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes, kCFRunLoopDefaultMode};
use core_foundation::string::CFString;
use parking_lot::Mutex;
use system_configuration::dynamic_store::{SCDynamicStore, SCDynamicStoreBuilder, SCDynamicStoreCallBackContext};
use tokio::sync::mpsc;

use crate::module::netmon::TriggerReason;
use crate::module::netmon::platform::PlatformMonitor;

/// 每次 run_in_mode 的最大阻塞时间；短轮询保证 stopping 快速生效，也能兜住
/// 极端 start/stop 竞态下 CFRunLoopStop 未命中初始 run 的场景。
const RUN_LOOP_POLL_INTERVAL: Duration = Duration::from_millis(500);

struct CallbackInfo {
    tx: mpsc::UnboundedSender<TriggerReason>,
    stopping: Arc<AtomicBool>,
}

struct MonitorInner {
    /// 在 run loop 线程内拿到的 CFRunLoop handle；主线程用它调 `stop()` 唤醒。
    /// CFRunLoop 在 core-foundation 0.9 已 `unsafe impl Send + Sync`。
    run_loop: CFRunLoop,
    thread: Option<JoinHandle<()>>,
}

pub struct MacosMonitor {
    inner: Mutex<Option<MonitorInner>>,
    stopping: Arc<AtomicBool>,
}

impl MacosMonitor {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[async_trait]
impl PlatformMonitor for MacosMonitor {
    // parking_lot MutexGuard 是 !Send，不能在 async fn 的 await 点之前“活着”
    // （会让 async fn future 变 !Send，违反 PlatformMonitor trait 的 Send 约束）。
    // 做法：所有持锁的同步工作放进独立 block，block 结束 guard 自然 drop；之后再
    // 做需要 await 的清理。block 结束时 drop 已是最紧，这里 allow 紧缩提示。
    #[allow(clippy::significant_drop_tightening)]
    async fn start(&self, tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        let setup: std::result::Result<(), (std::thread::JoinHandle<()>, anyhow::Error)> = {
            let mut guard = self.inner.lock();
            if guard.is_some() {
                return Ok(()); // 已启动，幂等
            }
            if self.stopping.load(Ordering::Acquire) {
                return Ok(()); // 已 stop，一次性：拒绝重启（与 Linux/Windows 一致）
            }

            let stopping = Arc::clone(&self.stopping);
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<CFRunLoop>>(1);

            let thread = std::thread::Builder::new()
                .name("netmon-macos-runloop".into())
                .spawn(move || {
                    run_loop_thread(tx, stopping, ready_tx);
                })
                .context("spawn netmon-macos-runloop thread")?;

            // 等 thread 建 store 成功并发回 run loop handle；5s 超时足够。
            // recv_timeout 是同步阻塞调用（不涉及 await），可在持锁状态下安全使用。
            match ready_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(run_loop)) => {
                    *guard = Some(MonitorInner {
                        run_loop,
                        thread: Some(thread),
                    });
                    Ok(())
                }
                Ok(Err(e)) => Err((thread, e.context("netmon-macos-runloop thread init"))),
                Err(_) => {
                    // 超时：thread 卡在未知位置（可能 SCDynamicStoreBuilder::build() /
                    // set_notification_keys() 等 CF 同步调用）。置 stopping 让循环尽快退出。
                    self.stopping.store(true, Ordering::Release);
                    Err((
                        thread,
                        anyhow::anyhow!("netmon-macos-runloop thread did not become ready in time"),
                    ))
                }
            }
            // guard 在此 drop
        };

        match setup {
            Ok(()) => {
                logging!(debug, Type::Network, "netmon macos: run loop thread started");
                Ok(())
            }
            Err((thread, err)) => {
                // 等 thread 自然退出后返错。join 丢给 spawn_blocking 以免当前 tokio
                // worker 被 CF 同步调用阻塞（current-thread runtime 下会整条 runtime 死锁）。
                let _ = tokio::task::spawn_blocking(move || thread.join()).await;
                Err(err)
            }
        }
    }

    async fn stop(&self) {
        // 1. 置 stopping：run loop 线程本轮 run_in_mode 返回后会立即退出
        self.stopping.store(true, Ordering::Release);
        // 2. 取出 inner，获得 run_loop + thread 的所有权
        let inner = self.inner.lock().take();
        if let Some(mut inner) = inner {
            // 3. 唤醒 run loop（本轮 run_in_mode 立即返回；stopping 已 true → 循环 break）
            inner.run_loop.stop();
            // 4. join thread：确保 store / source / context 已 Drop，不会再有 callback
            //    解引用 tx。run_loop_thread 退出是 Drop 链条的自然终点。
            //    run_in_mode 最多还要跑 500ms 才回 CFRunLoopRunResult::TimedOut
            //    并检查 stopping，join 甩给 spawn_blocking 避免阻塞 tokio worker。
            if let Some(thread) = inner.thread.take() {
                match tokio::task::spawn_blocking(move || thread.join()).await {
                    Ok(Ok(())) => {
                        logging!(debug, Type::Network, "netmon macos: run loop thread joined");
                    }
                    Ok(Err(e)) => {
                        logging!(
                            warn,
                            Type::Network,
                            "netmon macos: run loop thread join failed: {:?}",
                            e
                        );
                    }
                    Err(e) => {
                        logging!(
                            warn,
                            Type::Network,
                            "netmon macos: spawn_blocking(thread.join) panicked: {:?}",
                            e
                        );
                    }
                }
            }
        }
    }
}

fn run_loop_thread(
    tx: mpsc::UnboundedSender<TriggerReason>,
    stopping: Arc<AtomicBool>,
    ready_tx: std::sync::mpsc::SyncSender<Result<CFRunLoop>>,
) {
    let info = CallbackInfo {
        tx,
        stopping: Arc::clone(&stopping),
    };
    let callback_context = SCDynamicStoreCallBackContext {
        callout: on_store_changed,
        info,
    };

    let store = match SCDynamicStoreBuilder::new("clash-verge-netmon")
        .callback_context(callback_context)
        .build()
    {
        Some(s) => s,
        None => {
            let _ = ready_tx.send(Err(anyhow::anyhow!("SCDynamicStoreBuilder::build returned None")));
            return;
        }
    };

    // 订阅 keys（精确 match）和 patterns（regex-like）。粒度粗没关系，service
    // 层 3s debounce + fingerprint 会合并/去重。
    let watch_keys = CFArray::from_CFTypes(&[
        CFString::new("State:/Network/Global/IPv4"),
        CFString::new("State:/Network/Global/IPv6"),
        // DNS search domains 变化（DHCP 重下发 / VPN 连接带来新 suffix）也要
        // 触发 re-sample —— 即便链路未变，`dns_suffix` 的 fingerprint 变动需
        // 重新 PUT。与 `dns_suffix::collect_dns_suffix` 读取点保持闭环。
        CFString::new("State:/Network/Global/DNS"),
    ]);
    let watch_patterns = CFArray::from_CFTypes(&[
        CFString::new("State:/Network/Interface/[^/]+/IPv4"),
        CFString::new("State:/Network/Interface/[^/]+/IPv6"),
        CFString::new("State:/Network/Interface/[^/]+/Link"),
        // AirPort 覆盖同卡 SSID 切换：IPv4/Link 在 SSID 切到同子网新 AP 时可能
        // 不变，但这个 key 下面的 SSID_STR/BSSID 一定会更新。仅订阅 key 变化
        // 不需要 Location 权限；未来要读 SSID_STR/BSSID 值才需要（在 sampler 侧处理）。
        CFString::new("State:/Network/Interface/[^/]+/AirPort"),
    ]);
    if !store.set_notification_keys(&watch_keys, &watch_patterns) {
        let _ = ready_tx.send(Err(anyhow::anyhow!("SCDynamicStore::set_notification_keys failed")));
        return;
    }

    let run_loop_source = match store.create_run_loop_source() {
        Some(src) => src,
        None => {
            let _ = ready_tx.send(Err(anyhow::anyhow!(
                "SCDynamicStore::create_run_loop_source returned None"
            )));
            return;
        }
    };

    let current_run_loop = CFRunLoop::get_current();
    current_run_loop.add_source(&run_loop_source, unsafe { kCFRunLoopCommonModes });

    // 通知主线程：store / source / run loop 都就绪
    if ready_tx.send(Ok(current_run_loop)).is_err() {
        // 主线程已放弃等待（超时后 join），直接清理退出
        return;
    }
    drop(ready_tx);

    // 短轮询 run_in_mode 循环：每 500ms 检查 stopping，保证：
    // (a) 即使 stop() 的 CFRunLoopStop 在"run_in_mode 还未进入"时被调用，下一轮
    //     迭代也会看到 stopping=true 并退出
    // (b) 即使有排队的 source handler 还没被 dispatch，也会在下一轮 run_in_mode 里
    //     dispatch 完再检查 stopping
    loop {
        if stopping.load(Ordering::Acquire) {
            break;
        }
        let _ = CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, RUN_LOOP_POLL_INTERVAL, false);
    }
    // store / run_loop_source 随 scope 退出自然 Drop；store 托管的 callback context
    // 也一起 drop，tx 和 stopping Arc 被释放——此后 callback 不会被再次调用。
}

/// SCDynamicStore callback。跑在 run loop 线程上。
///
/// 稳定性约束（维护者必读）：
/// - 不加锁 / 不 await / 不 panic
/// - 只做 atomic check + 非阻塞 channel send
/// - tokio mpsc 满块时可能内部分配一次，与 configd / run loop 不死锁
fn on_store_changed(_store: SCDynamicStore, _changed_keys: CFArray<CFString>, info: &mut CallbackInfo) {
    if info.stopping.load(Ordering::Acquire) {
        return;
    }
    let _ = info.tx.send(TriggerReason::NetworkEvent);
}

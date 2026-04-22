//! Windows PlatformMonitor：三路订阅 `NotifyIpInterfaceChange` +
//! `NotifyRouteChange2` + `WlanRegisterNotification(SOURCE_ACM)`。
//!
//! 三个订阅共用一份 `MonitorState`（tx + stopping），callback 在各自 OS 工作
//! 线程触发，仅做 atomic-load + `UnboundedSender::send`。
//!
//! WLAN ACM 订阅负责补齐 IP 层订阅覆盖不到的盲区：同一 Wi-Fi 网卡上切换 SSID
//! 时，网卡保持 Up、IP 接口结构不变、默认路由的出口接口也不变
//! （两个 SSID 可能共用 gateway 子网或 Windows DHCP 合并事件），于是前两路都
//! 不触发。WLAN ACM 的 `connection_complete` / `disconnected` 在 L2 关联变化
//! 时必然触发。
//!
//! 关闭顺序（UAF 安全）：
//! 1. 置 `stopping = true`（callback 看到会立刻 return）
//! 2. `CancelMibChangeNotify2(iface)` + `CancelMibChangeNotify2(route)`：
//!    这两个 API 阻塞直到该 handle 对应 callback 全部 drain 完成
//! 3. `WlanRegisterNotification(wlan, SOURCE_NONE, ...)`：把通知源改为 NONE
//!    是 WLAN 侧的 drain 原语（docs 明确：WlanCloseHandle **不保证** callback 完全退出）
//! 4. `WlanCloseHandle(wlan)` 释放句柄
//! 5. 三个 drain 全部成功后 `Box::from_raw(state)` 释放共享 context；任一失败
//!    保守泄漏避免 UAF
//!
//! 顺序不可调换。WLAN 这路在 WlanSvc 未运行 / 无无线网卡 / 权限不足时会 open
//! 失败，走优雅降级（`wlan_handle = None`），IP Helper 两路照常工作。

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Result;
use async_trait::async_trait;
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use tokio::sync::mpsc;
use windows::Win32::Foundation::{HANDLE, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    CancelMibChangeNotify2, MIB_IPFORWARD_ROW2, MIB_IPINTERFACE_ROW, MIB_NOTIFICATION_TYPE, NotifyIpInterfaceChange,
    NotifyRouteChange2,
};
use windows::Win32::NetworkManagement::WiFi::{
    L2_NOTIFICATION_DATA, WLAN_API_VERSION_2_0, WLAN_NOTIFICATION_SOURCE_ACM, WLAN_NOTIFICATION_SOURCE_NONE,
    WlanCloseHandle, WlanOpenHandle, WlanRegisterNotification, wlan_notification_acm_connection_complete,
    wlan_notification_acm_disconnected, wlan_notification_acm_interface_arrival,
    wlan_notification_acm_interface_removal,
};
use windows::Win32::Networking::WinSock::AF_UNSPEC;

use crate::module::netmon::TriggerReason;
use crate::module::netmon::platform::PlatformMonitor;

struct MonitorState {
    tx: mpsc::UnboundedSender<TriggerReason>,
    stopping: Arc<AtomicBool>,
}

struct MonitorInner {
    iface_handle: HANDLE,
    route_handle: HANDLE,
    /// None = WlanSvc 不可用 / 无无线网卡 / 打开句柄失败。只有 IP Helper 两路工作。
    wlan_handle: Option<HANDLE>,
    state: *mut MonitorState,
}

// SAFETY: 三个 handle 分别是 IP Helper 和 WlanAPI 的通知句柄；state 指向
// Box::into_raw 分配的 MonitorState，其内部字段（UnboundedSender + Arc<AtomicBool>）
// 都是 Sync。MonitorInner 只在持锁时访问。
unsafe impl Send for MonitorInner {}

pub struct WindowsMonitor {
    inner: Mutex<Option<MonitorInner>>,
    stopping: Arc<AtomicBool>,
}

impl WindowsMonitor {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            stopping: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[async_trait]
impl PlatformMonitor for WindowsMonitor {
    // MutexGuard 有意持到函数末尾（含所有 FFI 调用），保证 start 与并发 stop 线性化：
    // stop 看到 inner=Some 就能 cancel，看到 None 就什么都不做。这是有意设计，
    // 不用 clippy 建议的"提前释放锁"。
    #[allow(clippy::significant_drop_tightening)]
    async fn start(&self, tx: mpsc::UnboundedSender<TriggerReason>) -> Result<()> {
        let mut guard = self.inner.lock();
        if guard.is_some() {
            // 已启动，幂等返回
            return Ok(());
        }
        if self.stopping.load(Ordering::Acquire) {
            // 已被 stop，拒绝再 start（与 Linux 保持一致：monitor 是一次性的）
            return Ok(());
        }

        let state = Box::new(MonitorState {
            tx,
            stopping: Arc::clone(&self.stopping),
        });
        let state_ptr: *mut MonitorState = Box::into_raw(state);
        let ctx_ptr = state_ptr as *const c_void;

        let mut iface_handle = HANDLE(ptr::null_mut());
        // SAFETY: ctx_ptr 指向 Box<MonitorState>，生命周期由 stop() 保证。
        // initialnotification=false：本 commit 的 Startup trigger 已经驱动首次 PUT。
        let err = unsafe {
            NotifyIpInterfaceChange(
                AF_UNSPEC,
                Some(on_ip_interface_change),
                Some(ctx_ptr),
                false,
                &mut iface_handle,
            )
        };
        if err != NO_ERROR {
            // 注册失败必须回收 Box，否则 leak
            // SAFETY: state_ptr 是本函数刚 Box::into_raw 的指针，唯一引用
            unsafe {
                drop(Box::from_raw(state_ptr));
            }
            anyhow::bail!("NotifyIpInterfaceChange: {:?}", err);
        }

        let mut route_handle = HANDLE(ptr::null_mut());
        // SAFETY: 同上；两个 callback 共享同一 caller context
        let err = unsafe { NotifyRouteChange2(AF_UNSPEC, Some(on_route_change), ctx_ptr, false, &mut route_handle) };
        if err != NO_ERROR {
            // 回滚：取消已注册的 iface_handle。仅在 cancel 成功时才释放 state
            // （与 stop() 同对称），否则保守泄漏避免 UAF。
            // SAFETY: iface_handle 由上面成功注册得到
            let cancel_err = unsafe { CancelMibChangeNotify2(iface_handle) };
            if cancel_err == NO_ERROR {
                // SAFETY: cancel 成功 = 未完成 callback 已 drain，state_ptr 不再被访问
                unsafe {
                    drop(Box::from_raw(state_ptr));
                }
            } else {
                logging!(
                    warn,
                    Type::Network,
                    "netmon windows: rollback CancelMibChangeNotify2 (iface) failed: {:?}, leaking MonitorState to avoid UAF",
                    cancel_err
                );
            }
            anyhow::bail!("NotifyRouteChange2: {:?}", err);
        }

        // WLAN ACM 订阅：可选路。失败路径不回滚已成功的两路——headless /
        // WlanSvc 停用 / 无无线网卡都是合法场景，IP Helper 两路足以覆盖。
        let wlan_handle = try_register_wlan(ctx_ptr);

        *guard = Some(MonitorInner {
            iface_handle,
            route_handle,
            wlan_handle,
            state: state_ptr,
        });
        logging!(
            debug,
            Type::Network,
            "netmon windows: notify handles registered (wlan={})",
            if wlan_handle.is_some() { "on" } else { "off" }
        );
        Ok(())
    }

    async fn stop(&self) {
        // 1. 置 stopping：已排队的 callback 一旦开跑立刻 return
        self.stopping.store(true, Ordering::Release);
        // 2. 顺序 drain 三路订阅（阻塞直到未完成 callback 返回）
        // 3. 仅当全部 drain 都成功才 drop state；否则保守泄漏（避免 UAF）
        let inner = self.inner.lock().take();
        if let Some(inner) = inner {
            // SAFETY: IP Helper 文档约定 CancelMibChangeNotify2 成功时阻塞直到
            // 对应 handle 的所有未完成 callback 返回；失败时无此保证。
            let (iface_err, route_err) = unsafe {
                (
                    CancelMibChangeNotify2(inner.iface_handle),
                    CancelMibChangeNotify2(inner.route_handle),
                )
            };
            if iface_err != NO_ERROR {
                logging!(
                    warn,
                    Type::Network,
                    "netmon windows: CancelMibChangeNotify2 (iface) failed: {:?}",
                    iface_err
                );
            }
            if route_err != NO_ERROR {
                logging!(
                    warn,
                    Type::Network,
                    "netmon windows: CancelMibChangeNotify2 (route) failed: {:?}",
                    route_err
                );
            }

            // WLAN drain：首选 WlanRegisterNotification(SOURCE_NONE) 做 drain
            // 原语（MSDN 明确：成功返回时 WLAN service 已 drain 所有 in-flight
            // callback）。若该调用失败，退一步靠 WlanCloseHandle 的实现行为：
            // MSDN 明写 "outstanding notifications are discarded on close"，而
            // 当前 wlanapi.dll 的引用计数实现还会等 in-flight dispatch 线程退出
            // 再返回（这属实现细节而非 MSDN 明文保证）。叠加 stopping=true 的
            // 前置屏障，残留 callback 即便跑也会在 Acquire-load 后立刻 return。
            // 两者都失败才回退保守泄漏。
            let wlan_drained = match inner.wlan_handle {
                Some(h) => {
                    // SAFETY: h 是 start() 成功打开的句柄；stop() 从 inner 中取走后
                    // 不会再有并发路径使用它。
                    let unreg_err = unsafe {
                        WlanRegisterNotification(h, WLAN_NOTIFICATION_SOURCE_NONE, false, None, None, None, None)
                    };
                    // WLAN API 返回裸 u32，不是 IP Helper 的 WIN32_ERROR newtype
                    if unreg_err != NO_ERROR.0 {
                        logging!(
                            warn,
                            Type::Network,
                            "netmon windows: WlanRegisterNotification(NONE) failed: {}",
                            unreg_err
                        );
                    }
                    let close_err = unsafe { WlanCloseHandle(h, None) };
                    if close_err != NO_ERROR.0 {
                        logging!(
                            warn,
                            Type::Network,
                            "netmon windows: WlanCloseHandle failed: {}",
                            close_err
                        );
                    }
                    // unreg 或 close 任一成功即算 drain 完成（两者各自都能让后续
                    // callback 不再 deref MonitorState）；都失败才放弃
                    unreg_err == NO_ERROR.0 || close_err == NO_ERROR.0
                }
                None => true, // 没订阅 WLAN，视为已 drain
            };

            if iface_err == NO_ERROR && route_err == NO_ERROR && wlan_drained {
                // SAFETY: 三路 drain 都成功 = 所有未完成 callback 已 drain，
                // 没有线程再持有 inner.state 指针。
                unsafe {
                    drop(Box::from_raw(inner.state));
                }
                logging!(debug, Type::Network, "netmon windows: notify handles canceled");
            } else {
                // 保守泄漏 Box<MonitorState>：进程生命周期内不再释放，避免 cancel
                // 失败场景下残余 callback 解引用野指针。反正这条分支本身就代表
                // API 进入不可恢复状态，泄漏一次是可接受代价。
                logging!(
                    warn,
                    Type::Network,
                    "netmon windows: drain failed on at least one subscription, leaking MonitorState to avoid UAF"
                );
            }
        }
    }
}

/// 尝试开 WlanSvc 句柄并订阅 ACM 通知。失败不是错误：WlanSvc 未运行 / 无无线
/// 网卡 / 无权限都会走这里，由外层保留 None 继续跑 IP Helper 两路。
fn try_register_wlan(ctx_ptr: *const c_void) -> Option<HANDLE> {
    let mut negotiated_version: u32 = 0;
    let mut wlan_handle = HANDLE(ptr::null_mut());
    // SAFETY: WlanOpenHandle 按文档接受 v2 版本号；wlan_handle 的生命周期由
    // MonitorInner 管理。
    let err = unsafe { WlanOpenHandle(WLAN_API_VERSION_2_0, None, &mut negotiated_version, &mut wlan_handle) };
    // WLAN API 返回裸 u32，不是 IP Helper 的 WIN32_ERROR newtype
    if err != NO_ERROR.0 {
        // 常见：ERROR_SERVICE_NOT_ACTIVE / RPC_S_SERVER_UNAVAILABLE（headless /
        // WlanSvc disabled）。不要 warn，保持 debug：用户的 headless 机器不应
        // 每次启动都看到一条吓人的 warn。
        logging!(
            debug,
            Type::Network,
            "netmon windows: WlanOpenHandle failed, skipping WLAN ACM subscription: {}",
            err
        );
        return None;
    }

    // bIgnoreDuplicate=true 让 WlanSvc 折叠连续相同 NotificationCode 的重复投递
    // （是字面 code 相等，不是语义相等）。被折叠掉的 event 不影响正确性：service 层
    // 还有 3s debounce + fingerprint，多少次 trigger 效果一样。
    // SAFETY: ctx_ptr 指向 Box<MonitorState>，生命周期由 stop() 保证。
    let err = unsafe {
        WlanRegisterNotification(
            wlan_handle,
            WLAN_NOTIFICATION_SOURCE_ACM,
            true,
            Some(on_wlan_notification),
            Some(ctx_ptr),
            None,
            None,
        )
    };
    if err != NO_ERROR.0 {
        logging!(
            warn,
            Type::Network,
            "netmon windows: WlanRegisterNotification failed: {}, closing handle",
            err
        );
        // SAFETY: wlan_handle 刚由 WlanOpenHandle 打开且唯一引用
        let _ = unsafe { WlanCloseHandle(wlan_handle, None) };
        return None;
    }
    Some(wlan_handle)
}

/// 过滤 WLAN ACM 通知：只有连接状态类的才触发重采，过滤掉 scan / profile /
/// background_scan 等 noise，避免事件风暴。
///
/// 采纳的 4 个 code：
/// - `connection_complete`：新 AP 关联完成 → SSID 切换的主信号
/// - `disconnected`：Wi-Fi 失联 → 可能变 offline
/// - `interface_arrival` / `interface_removal`：NIC 插拔（NotifyIpInterfaceChange
///   也会触发，这里更及时）
///
/// **已知 gap**：802.11r Fast Transition 漫游（企业 Wi-Fi 常见的同 SSID 不同 BSSID
/// 切换）由 `WLAN_NOTIFICATION_SOURCE_MSM` 投递，不走 ACM。消费场景极少遇到，FT 后
/// DHCP 续租通常会触发 `NotifyRouteChange2` / `NotifyIpInterfaceChange` 兜底，本实现
/// 不专门订阅 MSM。
const fn is_meaningful_acm_code(code: u32) -> bool {
    // WLAN_NOTIFICATION_ACM 的底层是 i32，但 L2_NOTIFICATION_DATA.NotificationCode
    // 是 u32；把各常量 .0 cast 成 u32 做比较。
    let cc = wlan_notification_acm_connection_complete.0 as u32;
    let dis = wlan_notification_acm_disconnected.0 as u32;
    let arr = wlan_notification_acm_interface_arrival.0 as u32;
    let rem = wlan_notification_acm_interface_removal.0 as u32;
    code == cc || code == dis || code == arr || code == rem
}

/// 三路 callback 共享的 `MonitorState` 指针 UAF 防御契约，显式写在一个地方避免
/// 各 callback 的 SAFETY 注释只描述一半、未来重构漏掉另一半：
///
/// - **防线 1**（早退出）：`stop()` 里 `stopping.store(true, Release)` **先于**
///   `CancelMibChangeNotify2` / `WlanRegisterNotification(SOURCE_NONE)` 执行；
///   callback 入口 `stopping.load(Acquire)` 读到 `true` 即立即 `return`，**不再**
///   对 `state` 后续字段（`tx` 等）进行任何访问，避免接触正在拆卸的 mpsc sender。
/// - **防线 2**（内存存活）：`CancelMibChangeNotify2` /
///   `WlanRegisterNotification(SOURCE_NONE)` 按 OS 文档约定**阻塞**直到所有
///   in-flight callback 返回，`MonitorState` 的 `Box::from_raw` / drop 发生在
///   cancel 返回之后 —— 故 callback 体内对 `state` 的任意字段访问（包括防线 1
///   的 `stopping.load`）发生时，底层内存必然仍然有效。
///
/// 只靠防线 2 亦足以避免 UAF；但 +防线 1 进一步避免 "callback 已在 cancel 之前
/// 入队，但此时 mpsc receiver 正在析构" 这类更窄窗口下的 TOCTOU 问题，同时让
/// 处于 shutdown 窗口的事件不会误入 debounce 队列。两者组合形成 belt-and-suspenders
/// 级别的安全保证。
///
/// NotifyIpInterfaceChange callback，跑在 IP Helper 工作线程。
///
/// 稳定性约束（任何维护者必读）：
/// - 不加锁 / 不 await / 不 panic
/// - 只做：`AtomicBool::load` + `UnboundedSender::send`（线程安全、非阻塞；
///   tokio mpsc 的 block 满时内部可能做一次分配，这与 IP Helper 不会死锁）
/// - 若未来需要复杂逻辑，必须先 send 一个 NetworkEvent，由 async 任务再处理
unsafe extern "system" fn on_ip_interface_change(
    caller_ctx: *const c_void,
    _row: *const MIB_IPINTERFACE_ROW,
    _kind: MIB_NOTIFICATION_TYPE,
) {
    // panic 跨 FFI 边界是 UB（workspace 使用 panic = "unwind"）；即便当前函数体
    // 只做 atomic-load + mpsc::send，未来维护者加日志/format! 可能意外引入 panic
    // 路径，这里兜底 catch_unwind 保险。
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if caller_ctx.is_null() {
            return;
        }
        // SAFETY: 见本文件顶 "三路 callback 共享的 MonitorState 指针 UAF 防御契约"
        // 两段防线的说明。caller_ctx 指向 start() 分配的 Box<MonitorState>。
        let state = unsafe { &*(caller_ctx.cast::<MonitorState>()) };
        if state.stopping.load(Ordering::Acquire) {
            return;
        }
        let _ = state.tx.send(TriggerReason::NetworkEvent);
    }));
}

/// NotifyRouteChange2 callback，同上的稳定性约束 + catch_unwind 兜底。
unsafe extern "system" fn on_route_change(
    caller_ctx: *const c_void,
    _row: *const MIB_IPFORWARD_ROW2,
    _kind: MIB_NOTIFICATION_TYPE,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if caller_ctx.is_null() {
            return;
        }
        // SAFETY: 同 on_ip_interface_change —— 见本文件 UAF 防御契约说明。
        let state = unsafe { &*(caller_ctx.cast::<MonitorState>()) };
        if state.stopping.load(Ordering::Acquire) {
            return;
        }
        let _ = state.tx.send(TriggerReason::NetworkEvent);
    }));
}

/// WLAN notification callback，跑在 WlanSvc 工作线程。同上稳定性约束。
///
/// 额外语义：虽然订阅时指定了 `SOURCE_ACM`，callback 里仍要防御性检查 source —
/// WlanSvc 偶尔会把非请求源的通知误发给回调（多见于 Win10 旧 build）。
/// 白名单过滤在 `is_meaningful_acm_code` 中，把 scan / profile / background_scan
/// 等高频 noise 拦在 mpsc 之外。
unsafe extern "system" fn on_wlan_notification(data: *mut L2_NOTIFICATION_DATA, context: *mut c_void) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if data.is_null() || context.is_null() {
            return;
        }
        // SAFETY: WlanSvc 保证 data 指向一个有效 L2_NOTIFICATION_DATA；
        // context 指向 start() 分配的 Box<MonitorState>，UAF 防御见本文件顶的
        // "三路 callback 共享的 MonitorState 指针 UAF 防御契约"。
        let d = unsafe { &*data };
        if !d.NotificationSource.contains(WLAN_NOTIFICATION_SOURCE_ACM) {
            return;
        }
        if !is_meaningful_acm_code(d.NotificationCode) {
            return;
        }
        let state = unsafe { &*(context.cast::<MonitorState>()) };
        if state.stopping.load(Ordering::Acquire) {
            return;
        }
        let _ = state.tx.send(TriggerReason::NetworkEvent);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acm_code_filter_accepts_signals() {
        assert!(is_meaningful_acm_code(
            wlan_notification_acm_connection_complete.0 as u32
        ));
        assert!(is_meaningful_acm_code(wlan_notification_acm_disconnected.0 as u32));
        assert!(is_meaningful_acm_code(wlan_notification_acm_interface_arrival.0 as u32));
        assert!(is_meaningful_acm_code(wlan_notification_acm_interface_removal.0 as u32));
    }

    #[test]
    fn acm_code_filter_rejects_noise() {
        use windows::Win32::NetworkManagement::WiFi::{
            wlan_notification_acm_autoconf_enabled, wlan_notification_acm_background_scan_enabled,
            wlan_notification_acm_connection_start, wlan_notification_acm_network_available,
            wlan_notification_acm_profile_change, wlan_notification_acm_scan_complete,
            wlan_notification_acm_scan_list_refresh,
        };
        // 一连串实际观察到的高频 / 无关 noise，必须被过滤
        for code in [
            wlan_notification_acm_scan_complete.0,
            wlan_notification_acm_scan_list_refresh.0,
            wlan_notification_acm_network_available.0,
            wlan_notification_acm_profile_change.0,
            wlan_notification_acm_background_scan_enabled.0,
            wlan_notification_acm_autoconf_enabled.0,
            wlan_notification_acm_connection_start.0, // 只认 complete，不认 start
        ] {
            assert!(
                !is_meaningful_acm_code(code as u32),
                "noise code {} should be filtered",
                code
            );
        }
    }
}

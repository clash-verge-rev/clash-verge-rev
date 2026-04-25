//! macOS CoreLocation 授权：读取 CWInterface.ssid/bssid 的前置条件（macOS 14+）。
//!
//! 状态机（两个入口，语义相同）：
//!
//! ```text
//! 入口 A: 用户 UI 翻 toggle ON → cmd::request_wifi_detection_auth (主线程派发)
//! 入口 B: setup 启动发现 config.enable_wifi_detection=true 且 status=NotDetermined
//!         (处理 fresh install / 重装 / TCC reset / 签名变化后 TCC 失效的场景)
//!
//! 两入口都走同一 `request_authorization()`：
//!       └─ status = NotDetermined → requestWhenInUseAuthorization() (异步弹窗)
//!          └─ delegate.locationManagerDidChangeAuthorization:
//!              ├─ 统一 emit `verge://wifi-auth-changed` → 前端 refetch 授权快照
//!              └─ 并 netmon::trigger(Manual) 让下一次采样反映新 ssid/bssid 状态
//!       └─ 其他 status → no-op（Authorized/Denied/Restricted 都不打扰用户）
//! ```
//!
//! **生命周期**：manager + delegate 必须存活整个应用期，否则 Obj-C 侧 retain
//! count 归零、delegate 被系统释放、后续授权变化回调不触发。用 `OnceLock`
//! 持有一个永久 guard。
//!
//! **线程归属**：
//! - `CLLocationManager::new` / `setDelegate` / `requestWhenInUseAuthorization`
//!   必须主线程。`init_on_main_thread` 和 `request_authorization` 内部用
//!   `MainThreadMarker::new()` 做运行时校验；非主线程调用会拒绝并 warn
//! - `authorizationStatus` 作为实例方法在 Apple 文档里并未显式声明线程安全。
//!   类方法 `+authorizationStatus` 才明确跨线程可用，但已 deprecated。本模块
//!   保守起见把 `current_status` 也要求主线程（通过 MainThreadMarker），由
//!   `request_wifi_detection_auth` 命令的 `run_on_main_thread` 派发保证
//! - `locationServicesEnabled_class()` 类方法 Apple 文档提示"可能阻塞磁盘 IO"，
//!   建议不要在主线程的热路径频繁调；本模块仅在 `get_wifi_detection_status`
//!   命令被前端显式调用时查询，调用频率极低，可接受
//!
//! **降级**：用户拒绝或全局位置服务关闭时，CWInterface.ssid() 仍返 nil，
//! sampler 的 filter 逻辑会自然降级到 None。上层 UI 通过 `current_status` +
//! `services_enabled` 区分"未授权"与"全局关闭"两种 case。
//!
//! **首次授权回调行为**：Apple 在设置 delegate 后会很快投递一次当前状态
//! `locationManagerDidChangeAuthorization:`，即使授权未变。Manual 触发进入
//! service loop 的 debounce 窗口后会被 Startup 吸收合并，不产生重复 PUT。

use std::sync::OnceLock;

use clash_verge_logging::{Type, logging};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{MainThreadOnly, define_class, msg_send};
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager, CLLocationManagerDelegate};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol};

use crate::core::handle::Handle;
use crate::module::netmon::{self, TriggerReason};

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CVRLocationDelegate"]
    struct LocationDelegate;

    unsafe impl NSObjectProtocol for LocationDelegate {}

    unsafe impl CLLocationManagerDelegate for LocationDelegate {
        // macOS 11+ 推荐回调（无参，用 manager.authorizationStatus() 查状态）。
        // 无论授权是 Authorized / Denied / Restricted，都走同一条路径：
        // 1. emit `wifi-auth-changed` 给前端刷新 UI（关键：Denied 时 sampler
        //    fingerprint 可能不变，不会走 netmon PUT → 无 network-context-updated
        //    事件，前端若只听后者会停在旧状态）
        // 2. trigger(Manual) 让下一次采样反映新 ssid 状态（Authorized 时补齐，
        //    Denied 时清空）
        #[unsafe(method(locationManagerDidChangeAuthorization:))]
        fn did_change_authorization(&self, _manager: &CLLocationManager) {
            Handle::notify_wifi_auth_changed();
            netmon::trigger(TriggerReason::Manual);
        }
    }
);

impl LocationDelegate {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// 永久持有 manager + delegate；Drop 即失去未来回调。进程生命周期内不释放。
struct LocationGuard {
    manager: Retained<CLLocationManager>,
    #[allow(dead_code)] // 仅用于保活
    delegate: Retained<LocationDelegate>,
}

// SAFETY: 跨线程只传递 Retained 指针所有权（OnceLock::get_or_init 期间），
// 实际的 Obj-C 方法调用全部限制在主线程（由 `init_on_main_thread` /
// `request_authorization` / `current_status` 的 MainThreadMarker 校验保证）。
// 在这个使用模式下 LocationGuard 可被视为 Send+Sync。
unsafe impl Send for LocationGuard {}
unsafe impl Sync for LocationGuard {}

static GUARD: OnceLock<LocationGuard> = OnceLock::new();

/// 在主线程预创建 manager + delegate；应用启动时调一次。setDelegate 不会
/// 触发任何授权弹窗，仅注册回调入口。后续 `request_authorization` 在用户
/// 触发时才弹窗。
///
/// 非主线程调用会被拒绝并 log warn；运行时兜底但建议调用方保证主线程。
pub fn init_on_main_thread() {
    let Some(mtm) = MainThreadMarker::new() else {
        logging!(
            warn,
            Type::Network,
            "netmon macos: init_on_main_thread called off main thread, skipping"
        );
        return;
    };
    let _ = GUARD.get_or_init(|| {
        // SAFETY: 主线程调用（由 MainThreadMarker 保证），manager/delegate
        // 生命周期由 OnceLock 持有。
        unsafe {
            let manager = CLLocationManager::new();
            let delegate = LocationDelegate::new(mtm);
            let proto = ProtocolObject::from_ref(&*delegate);
            manager.setDelegate(Some(proto));
            LocationGuard { manager, delegate }
        }
    });
}

/// 返回当前授权状态；从未 init 或非主线程调用时返回 `NotDetermined` 兜底。
/// `authorizationStatus` 实例方法未明确线程安全，调用方需在主线程。
pub fn current_status() -> CLAuthorizationStatus {
    if MainThreadMarker::new().is_none() {
        return CLAuthorizationStatus::NotDetermined;
    }
    match GUARD.get() {
        // SAFETY: 主线程 + manager 已在 init 中创建。
        Some(g) => unsafe { g.manager.authorizationStatus() },
        None => CLAuthorizationStatus::NotDetermined,
    }
}

/// 全局位置服务是否开启（系统设置 → 隐私与安全 → 位置服务 总开关）。
/// deprecated 类方法，至 Sequoia 仍可用；Apple 文档提示可能阻塞磁盘 IO，
/// 禁止在主线程的热路径频繁调用（本模块仅在前端主动刷新状态时查询，可接受）。
pub fn services_enabled() -> bool {
    // SAFETY: 类方法只读查询，跨线程安全。
    unsafe { CLLocationManager::locationServicesEnabled_class() }
}

/// 请求 When-In-Use 授权。必须主线程调用；非主线程静默 no-op。
/// - NotDetermined → 触发系统弹窗（用户看到 NSLocationWhenInUseUsageDescription）
/// - 其他状态 → no-op（系统忽略重复请求）
///
/// 调用完即返回；授权结果通过 `locationManagerDidChangeAuthorization:` 异步回调。
pub fn request_authorization() {
    if MainThreadMarker::new().is_none() {
        logging!(
            warn,
            Type::Network,
            "netmon macos: request_authorization called off main thread, skipping"
        );
        return;
    }
    let Some(g) = GUARD.get() else {
        return;
    };
    // SAFETY: 主线程调用（MainThreadMarker 已校验），manager 已初始化。
    unsafe {
        if g.manager.authorizationStatus() == CLAuthorizationStatus::NotDetermined {
            g.manager.requestWhenInUseAuthorization();
        }
    }
}

/// 把 CLAuthorizationStatus 映射到稳定的字符串，供前端展示。
/// `CLAuthorizationStatus` 是 `#[repr(transparent)] struct(c_int)` 而非 enum，
/// 用 if-else 链做值比较避免 non-exhaustive match 风险。
pub fn status_to_str(status: CLAuthorizationStatus) -> &'static str {
    if status == CLAuthorizationStatus::AuthorizedAlways || status == CLAuthorizationStatus::AuthorizedWhenInUse {
        "authorized"
    } else if status == CLAuthorizationStatus::Denied {
        "denied"
    } else if status == CLAuthorizationStatus::Restricted {
        "restricted"
    } else {
        "notDetermined"
    }
}

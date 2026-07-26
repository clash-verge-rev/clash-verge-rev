#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};

use clash_verge_logging::{Type, logging};

/// TUN + fake-ip 模式下写入活动网络服务的系统 DNS 服务器。
///
/// 该值需要与 `enhance::tun` 中启用 TUN 时写入的 DNS 保持一致。
pub const TUN_SYSTEM_DNS_SERVER: &str = "114.114.114.114";

/// Serializes every system-DNS mutation (the set/restore shell scripts). A wake
/// recovery task and the normal `enhance`/quit paths must not race on the live
/// network service, otherwise a delayed wake write could land after a restore.
static PUBLIC_DNS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(target_os = "macos")]
static TUN_DNS_MANAGEMENT_STATE: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
static WAKE_EVENT_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
const WAKE_DNS_RETRY_DELAYS: [std::time::Duration; 3] = [
    std::time::Duration::from_secs(2),
    std::time::Duration::from_secs(3),
    std::time::Duration::from_secs(5),
];

/// Pack the desired "should we manage the system DNS" flag together with a
/// monotonically increasing revision. Every time the desired state changes we
/// bump the revision so a stale scheduled reconcile task can detect that a newer
/// request superseded it and abort.
#[cfg(target_os = "macos")]
fn publish_tun_dns_management(manage: bool) -> u64 {
    let mut current = TUN_DNS_MANAGEMENT_STATE.load(Ordering::Acquire);
    loop {
        let revision = (current >> 1).wrapping_add(1);
        let next = (revision << 1) | u64::from(manage);
        match TUN_DNS_MANAGEMENT_STATE.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return next,
            Err(actual) => current = actual,
        }
    }
}

#[cfg(target_os = "macos")]
fn tun_dns_managed() -> bool {
    TUN_DNS_MANAGEMENT_STATE.load(Ordering::Acquire) & 1 == 1
}

/// A scheduled reconcile may run only if no newer request has been published
/// since it was scheduled, and the intended management state matches.
#[cfg(target_os = "macos")]
const fn should_run_dns_reconciliation(
    request_revision: u64,
    current_revision: u64,
    requested_management: bool,
    current_management: bool,
) -> bool {
    request_revision == current_revision && requested_management == current_management
}

/// Effective TUN state gates wake recovery: the runtime TUN must be enabled,
/// DNS management must currently be active, and the session must not have
/// suppressed TUN.
#[cfg(target_os = "macos")]
const fn should_recover_tun_dns_after_wake(tun_enabled: bool, dns_managed: bool, tun_suppressed: bool) -> bool {
    tun_enabled && dns_managed && !tun_suppressed
}

#[cfg(target_os = "macos")]
fn wake_dns_retry_delay(attempt: usize) -> Option<std::time::Duration> {
    WAKE_DNS_RETRY_DELAYS.get(attempt).copied()
}

/// Drive a wake recovery loop: wait for the network service to come back, then
/// recheck the guard and apply. Stale tasks bail out of `should_recover` once a
/// newer generation or a changed state invalidates them.
#[cfg(target_os = "macos")]
async fn run_wake_dns_recovery<ShouldRecover, ShouldRecoverFuture, Recover, RecoverFuture>(
    mut should_recover: ShouldRecover,
    mut recover: Recover,
) -> bool
where
    ShouldRecover: FnMut() -> ShouldRecoverFuture + Send,
    ShouldRecoverFuture: std::future::Future<Output = bool> + Send,
    Recover: FnMut() -> RecoverFuture + Send,
    RecoverFuture: std::future::Future<Output = bool> + Send,
{
    let mut attempt = 0;
    while let Some(delay) = wake_dns_retry_delay(attempt) {
        tokio::time::sleep(delay).await;
        if !should_recover().await {
            return false;
        }
        if recover().await {
            return true;
        }
        attempt += 1;
    }
    false
}

/// Perform a managed DNS transition while holding `PUBLIC_DNS_LOCK`. The
/// management flag is rechecked after the optional restore and after the set, so
/// a concurrent `enhance`/quit that flips the state mid-flight is compensated:
/// if management was dropped we restore and abort instead of leaving the TUN
/// DNS applied.
#[cfg(target_os = "macos")]
async fn run_managed_dns_transition<IsManaged, Restore, RestoreFuture, Set, SetFuture>(
    mut is_managed: IsManaged,
    restore_before_set: bool,
    mut restore: Restore,
    mut set: Set,
) -> bool
where
    IsManaged: FnMut() -> bool,
    Restore: FnMut() -> RestoreFuture,
    RestoreFuture: std::future::Future<Output = bool>,
    Set: FnMut() -> SetFuture,
    SetFuture: std::future::Future<Output = bool>,
{
    if !is_managed() {
        return false;
    }

    let restored = if restore_before_set { restore().await } else { true };
    if !is_managed() {
        return false;
    }

    let applied = set().await;
    if !is_managed() {
        let _ = restore().await;
        return false;
    }

    restored && applied
}

/// Set the system DNS for the active network service. Returns whether the
/// script reported success.
async fn set_public_dns_unlocked(dns_server: String) -> bool {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();

    logging!(info, Type::Config, "try to set system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return false;
        }
    };
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "set_dns.sh not found");
        return false;
    }
    let state_dir = match dirs::app_home_dir() {
        Ok(dir) => dir.join(".dns-state"),
        Err(e) => {
            logging!(error, Type::Config, "Failed to get DNS state directory: {}", e);
            return false;
        }
    };
    let script = script.to_string_lossy().into_owned();
    let state_dir = state_dir.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server, state_dir])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                logging!(info, Type::Config, "set system dns successfully");
                true
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "set system dns failed: {code}");
                false
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "set system dns failed: {err}");
            false
        }
    }
}

pub async fn set_public_dns(dns_server: String) {
    let _guard = PUBLIC_DNS_LOCK.lock().await;
    let _ = set_public_dns_unlocked(dns_server).await;
}

#[cfg(target_os = "macos")]
async fn restore_public_dns_unlocked() -> bool {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();
    logging!(info, Type::Config, "try to unset system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return false;
        }
    };
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "unset_dns.sh not found");
        return false;
    }
    let state_dir = match dirs::app_home_dir() {
        Ok(dir) => dir.join(".dns-state"),
        Err(e) => {
            logging!(error, Type::Config, "Failed to get DNS state directory: {}", e);
            return false;
        }
    };
    let legacy_state_file = resource_dir.join(".original_dns.txt");
    let script = script.to_string_lossy().into_owned();
    let state_dir = state_dir.to_string_lossy().into_owned();
    let legacy_state_file = legacy_state_file.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, state_dir, legacy_state_file])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                logging!(info, Type::Config, "unset system dns successfully");
                true
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "unset system dns failed: {code}");
                false
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "unset system dns failed: {err}");
            false
        }
    }
}

#[cfg(target_os = "macos")]
async fn apply_tun_dns_unlocked() -> bool {
    run_managed_dns_transition(tun_dns_managed, true, restore_public_dns_unlocked, || {
        set_public_dns_unlocked(TUN_SYSTEM_DNS_SERVER.to_string())
    })
    .await
}

/// Publish the desired management state and, after acquiring the DNS lock,
/// converge the system DNS to match it. Stale requests abort before touching
/// anything.
#[cfg(target_os = "macos")]
pub fn schedule_tun_dns_reconciliation(manage: bool) {
    use crate::process::AsyncHandler;

    let request_state = publish_tun_dns_management(manage);
    AsyncHandler::spawn(move || async move {
        let _guard = PUBLIC_DNS_LOCK.lock().await;
        let current_state = TUN_DNS_MANAGEMENT_STATE.load(Ordering::Acquire);
        if !should_run_dns_reconciliation(
            request_state >> 1,
            current_state >> 1,
            request_state & 1 == 1,
            current_state & 1 == 1,
        ) {
            return;
        }

        if manage {
            let _ = apply_tun_dns_unlocked().await;
        } else {
            let _ = restore_public_dns_unlocked().await;
        }
    });
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() -> bool {
    publish_tun_dns_management(false);
    let _guard = PUBLIC_DNS_LOCK.lock().await;
    restore_public_dns_unlocked().await
}

#[cfg(target_os = "macos")]
async fn reapply_tun_dns_after_wake() -> bool {
    let _guard = PUBLIC_DNS_LOCK.lock().await;
    run_managed_dns_transition(tun_dns_managed, false, restore_public_dns_unlocked, || {
        set_public_dns_unlocked(TUN_SYSTEM_DNS_SERVER.to_string())
    })
    .await
}

#[cfg(target_os = "macos")]
async fn wake_recovery_is_allowed(generation: u64) -> bool {
    use crate::{config::Config, core::handle};

    if generation != WAKE_EVENT_GENERATION.load(Ordering::Acquire) || handle::Handle::global().is_exiting() {
        return false;
    }
    let tun_enabled = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
    should_recover_tun_dns_after_wake(tun_enabled, tun_dns_managed(), Config::tun_suppressed_for_session())
}

#[cfg(target_os = "macos")]
mod wake_observer {
    use std::cell::OnceCell;

    use crate::process::AsyncHandler;
    use clash_verge_logging::{Type, logging};
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread as _, define_class, msg_send, sel};
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{NSNotification, NSObject};

    use super::{WAKE_EVENT_GENERATION, reapply_tun_dns_after_wake, run_wake_dns_recovery, wake_recovery_is_allowed};
    use std::sync::atomic::Ordering;

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "ClashVergeWorkspaceWakeObserver"]
        struct WorkspaceWakeObserver;

        impl WorkspaceWakeObserver {
            #[unsafe(method(systemDidWake:))]
            fn system_did_wake(&self, _notification: &NSNotification) {
                schedule_tun_dns_recovery();
            }
        }
    );

    impl WorkspaceWakeObserver {
        fn new() -> Retained<Self> {
            unsafe { msg_send![super(Self::alloc().set_ivars(())), init] }
        }
    }

    struct Registration(Retained<WorkspaceWakeObserver>);

    impl Registration {
        fn new() -> Self {
            let observer = WorkspaceWakeObserver::new();
            let notification_center = NSWorkspace::sharedWorkspace().notificationCenter();
            unsafe {
                notification_center.addObserver_selector_name_object(
                    &observer,
                    sel!(systemDidWake:),
                    Some(NSWorkspaceDidWakeNotification),
                    None,
                );
            }
            Self(observer)
        }
    }

    impl Drop for Registration {
        fn drop(&mut self) {
            let notification_center = NSWorkspace::sharedWorkspace().notificationCenter();
            unsafe {
                notification_center.removeObserver(&self.0);
            }
        }
    }

    thread_local! {
        static WORKSPACE_WAKE_OBSERVER: OnceCell<Registration> = const { OnceCell::new() };
    }

    fn schedule_tun_dns_recovery() {
        let generation = WAKE_EVENT_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
        logging!(info, Type::System, "macOS wake detected, scheduling TUN DNS recovery");
        AsyncHandler::spawn(move || async move {
            let recovered =
                run_wake_dns_recovery(move || wake_recovery_is_allowed(generation), reapply_tun_dns_after_wake).await;

            if recovered {
                logging!(info, Type::System, "TUN DNS recovered after macOS wake");
            } else if wake_recovery_is_allowed(generation).await {
                logging!(
                    error,
                    Type::System,
                    "TUN DNS recovery after macOS wake exhausted all retries"
                );
            } else {
                logging!(debug, Type::System, "TUN DNS recovery after macOS wake was cancelled");
            }
        });
    }

    pub fn register() {
        WORKSPACE_WAKE_OBSERVER.with(|cell| {
            if cell.get().is_some() {
                return;
            }
            if cell.set(Registration::new()).is_err() {
                logging!(error, Type::Setup, "Failed to retain macOS workspace wake observer");
                return;
            }
            logging!(info, Type::Setup, "Registered macOS workspace wake observer");
        });
    }
}

#[cfg(target_os = "macos")]
pub fn register_workspace_wake_observer() {
    wake_observer::register();
}

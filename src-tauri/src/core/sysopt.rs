use crate::{
    config::{Config, MixedPort},
    core::proxy_control::SystemProxyStateUnknown,
    singleton,
    utils::server,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProxyApplyStep {
    Sysproxy,
    Autoproxy,
}

const fn proxy_apply_steps(sys_enabled: bool, auto_enabled: bool) -> [ProxyApplyStep; 2] {
    // Disabling PAC clears WinINET proxy flags on Windows, so pure global
    // proxy mode must clear PAC before enabling Sysproxy.
    if sys_enabled && !auto_enabled {
        [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
    } else {
        [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
    }
}

/// Maximum guard drain time before OS state is unknown.
const GUARD_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

/// Authoritative OS state after a failed proxy write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthoritativeState {
    /// No write is known to have landed.
    Unchanged,
    /// A partial write left no known target.
    Unknown,
}

/// Choose state from reliable evidence that a write landed.
fn authoritative_state(error: &anyhow::Error, earlier_step_completed: bool) -> AuthoritativeState {
    // Linux setter success is not reliable write evidence.
    authoritative_state_from(!cfg!(target_os = "linux"), error, earlier_step_completed)
}

/// Testable form with explicit write-evidence reliability.
fn authoritative_state_from(
    write_evidence_is_reliable: bool,
    error: &anyhow::Error,
    earlier_step_completed: bool,
) -> AuthoritativeState {
    if !write_evidence_is_reliable {
        return AuthoritativeState::Unchanged;
    }
    // A completed earlier setter is evidence outside the current error.
    if earlier_step_completed {
        return AuthoritativeState::Unknown;
    }
    match error.downcast_ref::<sysproxy::Error>() {
        Some(sysproxy::Error::ProxyWrite { progress, .. }) if !progress.nothing_written() => {
            AuthoritativeState::Unknown
        }
        _ => AuthoritativeState::Unchanged,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OsProxyState {
    AlreadyApplied,
    DifferentOrUnknown,
}

fn target_is_already_in_place(snapshot: &sysproxy::ProxySnapshot, sys: &Sysproxy, auto: &Autoproxy) -> bool {
    if auto.enable {
        // PAC writes bypass state too.
        snapshot.matches_pac(auto) && snapshot.bypass_matches(&sys.bypass)
    } else if sys.enable {
        snapshot.matches_global(sys)
    } else {
        // Bypass state is inert while every proxy is disabled.
        snapshot.is_all_disabled()
    }
}

/// Treat failed reads as different so writes are skipped only with proof.
fn classify_os_proxy_state(snapshot: Result<bool>) -> OsProxyState {
    match snapshot {
        Ok(true) => OsProxyState::AlreadyApplied,
        _ => OsProxyState::DifferentOrUnknown,
    }
}

#[cfg(target_os = "macos")]
fn read_os_proxy_state(sys: &Sysproxy, auto: &Autoproxy) -> OsProxyState {
    // Use the per-protocol snapshot rather than the synthesized proxy view.
    let already_applied = Sysproxy::snapshot()
        .map(|snapshot| target_is_already_in_place(&snapshot, sys, auto))
        .map_err(anyhow::Error::from);

    if let Err(err) = &already_applied {
        logging!(warn, Type::Core, "failed to read OS proxy snapshot: {err:#}");
    }

    classify_os_proxy_state(already_applied)
}

#[cfg(not(target_os = "macos"))]
fn read_os_proxy_state(_sys: &Sysproxy, _auto: &Autoproxy) -> OsProxyState {
    classify_os_proxy_state(Err(anyhow::anyhow!("per-protocol proxy snapshots are macOS only")))
}

/// Disable, drain a racing guard if needed, then disable again.
async fn disable_until_the_last_write_is_ours<Disable, DisableFuture, Drain, DrainFuture>(
    drained: bool,
    disable: Disable,
    drain_again: Drain,
) -> Result<()>
where
    Disable: Fn() -> DisableFuture,
    DisableFuture: std::future::Future<Output = Result<()>>,
    Drain: FnOnce() -> DrainFuture,
    DrainFuture: std::future::Future<Output = bool>,
{
    disable().await?;
    if drained {
        return Ok(());
    }

    // The final disable must happen after the last in-flight guard write.
    if !drain_again().await {
        anyhow::bail!(
            "the system proxy guard did not finish within {GUARD_DRAIN_TIMEOUT:?}; the OS proxy state is unknown"
        );
    }
    disable().await
}

/// Return the first failure after logging every attempted write.
fn first_failure<const N: usize>(attempts: [(&'static str, Result<()>); N]) -> Result<()> {
    let mut first: Option<anyhow::Error> = None;
    for (what, outcome) in attempts {
        let Err(error) = outcome else { continue };
        logging!(warn, Type::Core, "failed to turn the {what} off: {error:#}");
        if first.is_none() {
            first = Some(error);
        }
    }
    first.map_or(Ok(()), Err)
}

/// Attempt to disable both proxy kinds even if the first fails.
fn disable_both<Global, Pac>(disable_global: Global, disable_pac: Pac) -> Result<()>
where
    Global: FnOnce() -> Result<()>,
    Pac: FnOnce() -> Result<()>,
{
    let global = disable_global();
    let pac = disable_pac();
    first_failure([("global proxy", global), ("PAC", pac)])
}

/// Force both proxy kinds off, in one blocking hop.
async fn disable_all_proxies(sys: Sysproxy, auto: Autoproxy) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        disable_both(
            || sys.set_system_proxy().map_err(anyhow::Error::from),
            || auto.set_auto_proxy().map_err(anyhow::Error::from),
        )
    })
    .await?
}

/// Reconcile OS and guard state while preserving the original failure.
async fn recover_from_failed_write<Guard, Compensate, CompensateFuture>(
    error: anyhow::Error,
    earlier_step_completed: bool,
    recover_guard: Guard,
    compensate: Compensate,
) -> anyhow::Error
where
    Guard: FnOnce(AuthoritativeState),
    Compensate: FnOnce() -> CompensateFuture,
    CompensateFuture: std::future::Future<Output = Result<()>>,
{
    let state = authoritative_state(&error, earlier_step_completed);
    recover_guard(state);

    match state {
        AuthoritativeState::Unchanged => error,
        AuthoritativeState::Unknown => {
            if let Err(compensation) = compensate().await {
                logging!(
                    warn,
                    Type::Core,
                    "failed to force the system proxy off after a partial write: {compensation:#}"
                );
            }
            error.context(SystemProxyStateUnknown)
        }
    }
}

async fn current_os_proxy_state(sys: Sysproxy, auto: Autoproxy) -> OsProxyState {
    tokio::task::spawn_blocking(move || read_os_proxy_state(&sys, &auto))
        .await
        .unwrap_or_else(|join_error| {
            logging!(warn, Type::Core, "failed to read OS proxy state: {join_error}");
            OsProxyState::DifferentOrUnknown
        })
}

pub(crate) struct Sysopt {
    update_lock: TokioMutex<()>,
    guard_operation_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            guard_operation_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let verge = Config::verge().await.latest_arc();
    let use_default = verge.use_default_bypass.unwrap_or(true);
    let custom_bypass = verge.system_proxy_bypass.as_deref().unwrap_or("");

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        format!("{DEFAULT_BYPASS},{custom_bypass}").into()
    } else {
        custom_bypass.into()
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    /// Stop the guard and return whether it drained.
    async fn stop_proxy_guard_locked(&self) -> bool {
        // Drop the parking_lot read guard before awaiting.
        let idle = self.access_guard().read().shutdown();
        let drained = idle.wait_timeout(GUARD_DRAIN_TIMEOUT).await;
        if !drained {
            logging!(
                warn,
                Type::Core,
                "the system proxy guard did not finish within {GUARD_DRAIN_TIMEOUT:?}"
            );
        }
        drained
    }

    /// Stop the guard before handing OS proxy ownership elsewhere.
    pub(super) async fn stop_proxy_guard(&self) -> bool {
        let _operation = self.guard_operation_lock.lock().await;
        self.stop_proxy_guard_locked().await
    }

    /// Reconcile guard state with configuration and report success.
    pub(super) async fn refresh_guard(&self) -> bool {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let verge = Config::verge().await.latest_arc();
        let _operation = self.guard_operation_lock.lock().await;
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            let _drained = self.stop_proxy_guard_locked().await;
            return true;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            let _drained = self.stop_proxy_guard_locked().await;
            return true;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            if !guard.read().start() {
                logging!(
                    warn,
                    Type::Core,
                    "the system proxy guard refused to start; a previous run has not finished"
                );
            }
        }
        while self.access_guard().read().get_state().is_pendding() {
            tokio::task::yield_now().await;
        }
        // `start()` false may also mean a guard was already running.
        !self.access_guard().read().get_state().is_stopped()
    }

    /// Recover OS and guard state after a failed write.
    async fn recover_from_failed_write(
        &self,
        error: anyhow::Error,
        earlier_step_completed: bool,
        guard_was_running: bool,
        off: (Sysproxy, Autoproxy),
    ) -> anyhow::Error {
        recover_from_failed_write(
            error,
            earlier_step_completed,
            |state| self.recover_guard_after_failure(state, guard_was_running),
            || disable_all_proxies(off.0, off.1),
        )
        .await
    }

    /// Reconcile the guard with the authoritative state.
    fn recover_guard_after_failure(&self, state: AuthoritativeState, was_running: bool) {
        match state {
            AuthoritativeState::Unchanged if was_running => {
                let restarted = self.access_guard().read().start();
                if !restarted {
                    logging!(
                        warn,
                        Type::Core,
                        "the system proxy guard refused to start again after a failed write; it is not running"
                    );
                }
            }
            AuthoritativeState::Unchanged => {}
            AuthoritativeState::Unknown => {
                self.access_guard().write().set_guard_type(GuardType::None);
            }
        }
    }

    /// Wait for any in-progress `update_sysproxy` to finish, so that a
    /// subsequent read of OS-level sysproxy state sees a fully applied
    /// configuration instead of a partially-applied one (e.g. SOCKS already
    /// disabled but HTTP still enabled mid-transition).
    pub(crate) async fn wait_idle(&self) {
        let _ = self.update_lock.lock().await;
    }

    /// init the sysproxy
    pub(super) async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_lock.lock().await;
        let verge = Config::verge().await.latest_arc();
        // Configured, not live: this runs while the Core is being started or restarted, and
        // asking a Core that is not up yet would only fall back here anyway.
        let port = MixedPort::desired().await;
        let pac_port = server::embedded_server_port()?;
        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys_enable, pac_enable, proxy_host, proxy_guard) = (
            verge.enable_system_proxy.unwrap_or_default(),
            verge.proxy_auto_config.unwrap_or_default(),
            verge.proxy_host.as_deref().unwrap_or("127.0.0.1"),
            verge.enable_proxy_guard.unwrap_or_default(),
        );

        let (sys, auto, guard_type) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.host = proxy_host.into();
            sys.port = port;
            sys.bypass = bypass.into();
            auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

            // `enable_system_proxy` is the master switch.
            // When disabled, force clear both global proxy and PAC at OS level.
            let guard_type = if !sys_enable {
                sys.enable = false;
                auto.enable = false;
                GuardType::None
            } else if pac_enable {
                sys.enable = false;
                auto.enable = true;
                if proxy_guard {
                    GuardType::Autoproxy(auto.clone())
                } else {
                    GuardType::None
                }
            } else {
                sys.enable = true;
                auto.enable = false;
                if proxy_guard {
                    GuardType::Sysproxy(sys.clone())
                } else {
                    GuardType::None
                }
            };

            (sys.clone(), auto.clone(), guard_type)
        };

        let _guard_operation = self.guard_operation_lock.lock().await;

        // Drain the guard before any OS read or write.
        let guard_was_running = !self.access_guard().read().get_state().is_stopped();
        let idle = self.access_guard().read().shutdown();
        let drained = idle.wait_timeout(GUARD_DRAIN_TIMEOUT).await;
        if !drained {
            // A pending guard write makes OS state unknown.
            self.access_guard().write().set_guard_type(GuardType::None);
            anyhow::bail!(
                "the system proxy guard did not finish within {GUARD_DRAIN_TIMEOUT:?}; the OS proxy state is unknown"
            );
        }

        // Skip writes only when macOS exactly matches the target.
        if cfg!(target_os = "macos")
            && current_os_proxy_state(sys.clone(), auto.clone()).await == OsProxyState::AlreadyApplied
        {
            self.access_guard().write().set_guard_type(guard_type);
            return Ok(());
        }

        let apply_steps = proxy_apply_steps(sys.enable, auto.enable);

        // Prepare the disabled state used to compensate a partial write.
        let compensation = {
            let (mut off_sys, mut off_auto) = (sys.clone(), auto.clone());
            off_sys.enable = false;
            off_auto.enable = false;
            (off_sys, off_auto)
        };

        // Track whether an earlier setter already changed the OS.
        let applied = tokio::task::spawn_blocking(move || {
            for (index, step) in apply_steps.into_iter().enumerate() {
                let written = match step {
                    ProxyApplyStep::Autoproxy => auto.set_auto_proxy(),
                    ProxyApplyStep::Sysproxy => sys.set_system_proxy(),
                };
                if let Err(error) = written {
                    return Err((index > 0, anyhow::Error::from(error)));
                }
            }
            Ok(())
        })
        .await;

        match applied {
            Ok(Ok(())) => {}
            Ok(Err((earlier_step_completed, error))) => {
                return Err(self
                    .recover_from_failed_write(error, earlier_step_completed, guard_was_running, compensation)
                    .await);
            }
            Err(join_error) => {
                let error = anyhow::Error::from(join_error).context("the system proxy write task did not finish");
                return Err(self
                    .recover_from_failed_write(error, false, guard_was_running, compensation)
                    .await);
            }
        }

        // Never point the guard at a target that failed to reach the OS.
        self.access_guard().write().set_guard_type(guard_type);
        Ok(())
    }

    /// reset the sysproxy
    pub(super) async fn reset_sysproxy(&self) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }
        let _lock = self.update_lock.lock().await;
        let _guard_operation = self.guard_operation_lock.lock().await;
        let drained = self.stop_proxy_guard_locked().await;

        // 直接关闭所有代理
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        // The match is trustworthy only after the guard drained.
        if cfg!(target_os = "macos")
            && drained
            && current_os_proxy_state(sys.clone(), auto.clone()).await == OsProxyState::AlreadyApplied
        {
            return Ok(());
        }

        disable_until_the_last_write_is_ours(
            drained,
            || disable_all_proxies(sys.clone(), auto.clone()),
            || self.stop_proxy_guard_locked(),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AuthoritativeState, OsProxyState, ProxyApplyStep, SystemProxyStateUnknown, authoritative_state,
        authoritative_state_from, classify_os_proxy_state, disable_both, disable_until_the_last_write_is_ours,
        first_failure, proxy_apply_steps, recover_from_failed_write, target_is_already_in_place,
    };
    use parking_lot::Mutex;
    use std::collections::VecDeque;
    use sysproxy::{Autoproxy, Sysproxy};

    async fn record_disable_sequence(
        drained: bool,
        second_drain: bool,
        disable_answers: &[bool],
    ) -> (Vec<&'static str>, bool) {
        let calls = Mutex::new(Vec::new());
        let remaining = Mutex::new(disable_answers.iter().copied().collect::<VecDeque<bool>>());
        let result = disable_until_the_last_write_is_ours(
            drained,
            || {
                calls.lock().push("disable");
                let succeeds = remaining.lock().pop_front().unwrap_or(true);
                async move {
                    if succeeds {
                        Ok(())
                    } else {
                        anyhow::bail!("networksetup refused")
                    }
                }
            },
            || {
                calls.lock().push("drain");
                async move { second_drain }
            },
        )
        .await;
        (calls.into_inner(), result.is_ok())
    }

    fn failure_text(result: anyhow::Result<()>) -> std::string::String {
        result.map_or_else(|error| format!("{error:#}"), |()| "no failure".to_owned())
    }

    #[test]
    fn every_proxy_kind_is_attempted_even_after_one_of_them_failed() {
        let attempted = Mutex::new(Vec::new());

        let failed = disable_both(
            || {
                attempted.lock().push("global proxy");
                Err(anyhow::anyhow!("global refused"))
            },
            || {
                attempted.lock().push("PAC");
                Err(anyhow::anyhow!("PAC refused"))
            },
        );

        assert_eq!(&*attempted.lock(), &["global proxy", "PAC"]);
        assert_eq!(failure_text(failed), "global refused");
    }

    #[test]
    fn a_later_failure_is_still_reported_when_the_first_one_succeeded() {
        let failed = first_failure([("global proxy", Ok(())), ("PAC", Err(anyhow::anyhow!("PAC refused")))]);

        assert_eq!(failure_text(failed), "PAC refused");
    }

    #[test]
    fn nothing_is_reported_when_every_kind_went_through() {
        assert!(first_failure([("global proxy", Ok(())), ("PAC", Ok(()))]).is_ok());
    }

    struct Recovery {
        guard_told: Option<AuthoritativeState>,
        compensated: bool,
        state_unknown: bool,
        message: String,
    }

    async fn record_recovery(error: anyhow::Error, earlier_step_completed: bool, compensation_works: bool) -> Recovery {
        let guard_told = Mutex::new(None);
        let compensated = Mutex::new(false);
        let recovered = recover_from_failed_write(
            error,
            earlier_step_completed,
            |state| *guard_told.lock() = Some(state),
            || {
                *compensated.lock() = true;
                async move {
                    if compensation_works {
                        Ok(())
                    } else {
                        anyhow::bail!("the compensation was refused too")
                    }
                }
            },
        )
        .await;

        Recovery {
            guard_told: *guard_told.lock(),
            compensated: *compensated.lock(),
            state_unknown: SystemProxyStateUnknown::is_in(&recovered),
            message: format!("{recovered:#}"),
        }
    }

    fn refused() -> anyhow::Error {
        anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(0, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        })
    }

    fn partly_written() -> anyhow::Error {
        anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(3, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        })
    }

    #[tokio::test]
    async fn a_failure_that_wrote_nothing_is_not_compensated_for() {
        let recovery = record_recovery(refused(), false, true).await;

        assert!(!recovery.compensated);
        assert_eq!(recovery.guard_told, Some(AuthoritativeState::Unchanged));
        assert!(!recovery.state_unknown);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn nothing_on_linux_ever_reaches_the_destructive_row() {
        for earlier_step_completed in [false, true] {
            let recovery = record_recovery(partly_written(), earlier_step_completed, true).await;

            assert!(!recovery.compensated, "{earlier_step_completed}");
            assert_eq!(recovery.guard_told, Some(AuthoritativeState::Unchanged));
            assert!(!recovery.state_unknown);
        }
    }

    #[cfg(not(target_os = "linux"))]
    #[tokio::test]
    async fn a_failure_that_wrote_something_forces_the_proxy_off() {
        let recovery = record_recovery(partly_written(), false, true).await;

        assert!(recovery.compensated);
        assert_eq!(recovery.guard_told, Some(AuthoritativeState::Unknown));
        assert!(recovery.state_unknown);
    }

    #[cfg(not(target_os = "linux"))]
    #[tokio::test]
    async fn a_compensation_that_fails_does_not_replace_the_diagnosis() {
        let recovery = record_recovery(partly_written(), false, false).await;

        assert!(recovery.compensated);
        assert!(recovery.message.contains("admin privileges"));
        assert!(!recovery.message.contains("the compensation was refused too"));
        assert!(recovery.state_unknown);
    }

    #[cfg(not(target_os = "linux"))]
    #[tokio::test]
    async fn an_earlier_setter_that_finished_reaches_the_second_row_too() {
        let recovery = record_recovery(refused(), true, true).await;

        assert!(recovery.compensated);
        assert_eq!(recovery.guard_told, Some(AuthoritativeState::Unknown));
        assert!(recovery.state_unknown);
    }

    #[tokio::test]
    async fn a_drained_guard_needs_only_one_write() {
        assert_eq!(
            record_disable_sequence(true, true, &[true]).await,
            (vec!["disable"], true)
        );
    }

    #[tokio::test]
    async fn a_write_that_raced_the_guard_is_repeated_after_it_finishes() {
        assert_eq!(
            record_disable_sequence(false, true, &[true, true]).await,
            (vec!["disable", "drain", "disable"], true)
        );
    }

    #[tokio::test]
    async fn a_second_write_that_fails_on_its_own_is_still_reported() {
        assert_eq!(
            record_disable_sequence(false, true, &[true, false]).await,
            (vec!["disable", "drain", "disable"], false)
        );
    }

    #[tokio::test]
    async fn a_guard_that_never_finishes_is_reported_rather_than_written_over() {
        assert_eq!(
            record_disable_sequence(false, false, &[true]).await,
            (vec!["disable", "drain"], false)
        );
    }

    #[tokio::test]
    async fn a_refused_write_stops_before_waiting_on_anything() {
        assert_eq!(
            record_disable_sequence(false, true, &[false]).await,
            (vec!["disable"], false)
        );
    }

    #[test]
    fn a_failure_with_nothing_written_leaves_the_old_guard_worth_restoring() {
        let refused = anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges);

        assert_eq!(authoritative_state(&refused, false), AuthoritativeState::Unchanged);
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn only_evidence_that_a_write_landed_stands_the_guard_down() {
        let nothing_written = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(0, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        });
        let something_written = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(3, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        });

        assert_eq!(
            authoritative_state(&nothing_written, false),
            AuthoritativeState::Unchanged
        );
        assert_eq!(
            authoritative_state(&something_written, false),
            AuthoritativeState::Unknown
        );
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn a_step_that_already_finished_stands_the_guard_down_whatever_the_error_says() {
        let refused = anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges);

        assert_eq!(authoritative_state(&refused, false), AuthoritativeState::Unchanged);
        assert_eq!(authoritative_state(&refused, true), AuthoritativeState::Unknown);
    }

    #[test]
    fn where_a_successful_setter_proves_nothing_no_failure_is_destructive() {
        let strongest_evidence = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(3, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        });

        for earlier_step_completed in [false, true] {
            assert_eq!(
                authoritative_state_from(false, &strongest_evidence, earlier_step_completed),
                AuthoritativeState::Unchanged,
                "{earlier_step_completed}"
            );
        }
    }

    #[test]
    fn where_it_proves_something_both_kinds_of_evidence_count() {
        let nothing_written = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(0, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        });
        let partly_written = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(3, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        });

        assert_eq!(
            authoritative_state_from(true, &nothing_written, false),
            AuthoritativeState::Unchanged
        );
        assert_eq!(
            authoritative_state_from(true, &partly_written, false),
            AuthoritativeState::Unknown
        );
        assert_eq!(
            authoritative_state_from(true, &nothing_written, true),
            AuthoritativeState::Unknown
        );
    }

    fn holding_global(port: u16) -> sysproxy::ProxySnapshot {
        let endpoint = || sysproxy::ProxyEndpoint {
            host: "127.0.0.1".to_owned(),
            port,
            enable: true,
            switched_on: true,
        };
        sysproxy::ProxySnapshot {
            socks: endpoint(),
            http: endpoint(),
            https: endpoint(),
            auto: sysproxy::Autoproxy {
                url: std::string::String::new(),
                enable: false,
            },
            auto_switched_on: false,
            bypass: "localhost".to_owned(),
        }
    }

    fn holding_nothing() -> sysproxy::ProxySnapshot {
        let off = || sysproxy::ProxyEndpoint {
            host: std::string::String::new(),
            port: 0,
            enable: false,
            switched_on: false,
        };
        sysproxy::ProxySnapshot {
            socks: off(),
            http: off(),
            https: off(),
            auto: sysproxy::Autoproxy {
                url: std::string::String::new(),
                enable: false,
            },
            auto_switched_on: false,
            bypass: std::string::String::new(),
        }
    }

    fn global_target(port: u16) -> Sysproxy {
        Sysproxy {
            enable: true,
            host: "127.0.0.1".to_owned(),
            port,
            bypass: "localhost".to_owned(),
        }
    }

    fn pac_mode_target() -> Sysproxy {
        Sysproxy {
            enable: false,
            ..global_target(7897)
        }
    }

    fn pac_off() -> Autoproxy {
        Autoproxy {
            url: std::string::String::new(),
            enable: false,
        }
    }

    #[test]
    fn a_proxy_the_os_already_points_at_needs_no_write() {
        assert!(target_is_already_in_place(
            &holding_global(7897),
            &global_target(7897),
            &pac_off()
        ));
    }

    #[test]
    fn a_proxy_pointing_at_a_different_port_still_has_to_be_written() {
        assert!(!target_is_already_in_place(
            &holding_global(7897),
            &global_target(7898),
            &pac_off()
        ));
    }

    #[test]
    fn a_pac_target_asks_the_pac_question_and_not_the_global_one() {
        let pac = Autoproxy {
            url: "http://127.0.0.1:33333/commands/pac".to_owned(),
            enable: true,
        };
        let mut os_holds_pac = holding_nothing();
        os_holds_pac.auto = pac.clone();
        os_holds_pac.auto_switched_on = true;
        os_holds_pac.bypass = "localhost".to_owned();

        assert!(target_is_already_in_place(&os_holds_pac, &pac_mode_target(), &pac));
    }

    #[test]
    fn a_pac_target_whose_bypass_changed_still_has_to_be_written() {
        let pac = Autoproxy {
            url: "http://127.0.0.1:33333/commands/pac".to_owned(),
            enable: true,
        };
        let mut os_holds_pac = holding_nothing();
        os_holds_pac.auto = pac.clone();
        os_holds_pac.auto_switched_on = true;
        os_holds_pac.bypass = "localhost,example.com".to_owned();

        assert!(!target_is_already_in_place(&os_holds_pac, &pac_mode_target(), &pac));
    }

    #[test]
    fn a_switch_left_on_over_nothing_is_not_already_disabled() {
        let mut stranded = holding_nothing();
        stranded.http = sysproxy::ProxyEndpoint {
            host: std::string::String::new(),
            port: 0,
            enable: false,
            switched_on: true,
        };

        assert!(!target_is_already_in_place(
            &stranded,
            &Sysproxy {
                enable: false,
                ..global_target(7897)
            },
            &pac_off()
        ));
    }

    #[test]
    fn a_target_of_nothing_does_not_ask_about_the_bypass_list() {
        let mut os_holds_nothing = holding_nothing();
        os_holds_nothing.bypass = "something.else".to_owned();

        assert!(target_is_already_in_place(
            &os_holds_nothing,
            &Sysproxy {
                enable: false,
                ..global_target(7897)
            },
            &pac_off()
        ));
    }

    #[test]
    fn a_target_of_nothing_asks_whether_the_os_holds_nothing() {
        let nothing_wanted = Sysproxy {
            enable: false,
            ..global_target(7897)
        };

        assert!(target_is_already_in_place(
            &holding_nothing(),
            &nothing_wanted,
            &pac_off()
        ));
        assert!(!target_is_already_in_place(
            &holding_global(7897),
            &nothing_wanted,
            &pac_off()
        ));
    }

    #[test]
    fn only_a_snapshot_that_agrees_with_the_target_skips_the_write() {
        assert_eq!(classify_os_proxy_state(Ok(true)), OsProxyState::AlreadyApplied);
        assert_eq!(classify_os_proxy_state(Ok(false)), OsProxyState::DifferentOrUnknown);
    }

    #[test]
    fn a_failed_read_never_counts_as_agreement() {
        assert_eq!(
            classify_os_proxy_state(Err(anyhow::anyhow!("read failed"))),
            OsProxyState::DifferentOrUnknown
        );
    }

    #[test]
    fn pure_sysproxy_mode_clears_pac_before_enabling_global_proxy() {
        assert_eq!(
            proxy_apply_steps(true, false),
            [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
        );
    }

    #[test]
    fn pac_mode_clears_global_proxy_before_enabling_pac() {
        assert_eq!(
            proxy_apply_steps(false, true),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn disabled_mode_clears_global_proxy_before_pac() {
        assert_eq!(
            proxy_apply_steps(false, false),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }
}

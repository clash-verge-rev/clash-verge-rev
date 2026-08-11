use crate::{
    config::{Config, MixedPort},
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

/// Guard state after a failed proxy write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GuardRecovery {
    /// No write is known to have landed.
    Restore,
    /// A partial write left no authoritative target.
    StandDown,
}

/// Choose recovery from positive evidence that a write landed.
fn guard_recovery(error: &anyhow::Error, earlier_step_completed: bool) -> GuardRecovery {
    // A completed earlier setter is evidence outside the current error.
    if earlier_step_completed {
        return GuardRecovery::StandDown;
    }
    match error.downcast_ref::<sysproxy::Error>() {
        Some(sysproxy::Error::ProxyWrite { progress, .. }) if !progress.nothing_written() => GuardRecovery::StandDown,
        _ => GuardRecovery::Restore,
    }
}

/// What the OS currently holds, as far as we can prove it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OsProxyState {
    /// Every protocol and PAC entry read back disabled.
    Clean,
    /// A proxy is enabled or its state is unknown.
    DirtyOrUnknown,
}

/// Treat failed or enabled snapshots as dirty.
fn classify_os_proxy_state(snapshot: Result<bool>) -> OsProxyState {
    match snapshot {
        Ok(true) => OsProxyState::Clean,
        _ => OsProxyState::DirtyOrUnknown,
    }
}

/// Read proxy state without invoking privileged writes.
#[cfg(target_os = "macos")]
fn read_os_proxy_state() -> OsProxyState {
    // Use the per-protocol snapshot rather than the synthesized proxy view.
    let all_disabled = Sysproxy::snapshot()
        .map(|snapshot| snapshot.is_all_disabled())
        .map_err(anyhow::Error::from);

    if let Err(err) = &all_disabled {
        logging!(warn, Type::Core, "failed to read OS proxy snapshot: {err:#}");
    }

    classify_os_proxy_state(all_disabled)
}

/// Other platforms cannot prove the per-protocol state is clean.
#[cfg(not(target_os = "macos"))]
fn read_os_proxy_state() -> OsProxyState {
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

/// Force both proxy kinds off, in one blocking hop.
async fn disable_all_proxies(sys: Sysproxy, auto: Autoproxy) -> Result<()> {
    tokio::task::spawn_blocking(move || -> Result<()> {
        sys.set_system_proxy()?;
        auto.set_auto_proxy()?;
        Ok(())
    })
    .await?
}

async fn current_os_proxy_state() -> OsProxyState {
    tokio::task::spawn_blocking(read_os_proxy_state)
        .await
        .unwrap_or_else(|join_error| {
            logging!(warn, Type::Core, "failed to read OS proxy state: {join_error}");
            OsProxyState::DirtyOrUnknown
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

    /// Restore or stand down a previously running guard after failure.
    fn recover_guard_after_failure(&self, error: &anyhow::Error, earlier_step_completed: bool, was_running: bool) {
        match guard_recovery(error, earlier_step_completed) {
            GuardRecovery::Restore if was_running => {
                let restarted = self.access_guard().read().start();
                if !restarted {
                    logging!(
                        warn,
                        Type::Core,
                        "the system proxy guard refused to start again after a failed write; it is not running"
                    );
                }
            }
            GuardRecovery::Restore => {}
            GuardRecovery::StandDown => {
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

        // Only macOS reads exactly the state its disable path writes.
        if cfg!(target_os = "macos")
            && !sys.enable
            && !auto.enable
            && current_os_proxy_state().await == OsProxyState::Clean
        {
            self.access_guard().write().set_guard_type(guard_type);
            return Ok(());
        }

        let apply_steps = proxy_apply_steps(sys.enable, auto.enable);

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
                self.recover_guard_after_failure(&error, earlier_step_completed, guard_was_running);
                return Err(error);
            }
            Err(join_error) => {
                let error = anyhow::Error::from(join_error).context("the system proxy write task did not finish");
                self.recover_guard_after_failure(&error, false, guard_was_running);
                return Err(error);
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

        // Skip the privileged write only after the guard drained and macOS is clean.
        if cfg!(target_os = "macos") && drained && current_os_proxy_state().await == OsProxyState::Clean {
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
        GuardRecovery, OsProxyState, ProxyApplyStep, classify_os_proxy_state, disable_until_the_last_write_is_ours,
        guard_recovery, proxy_apply_steps,
    };
    use parking_lot::Mutex;
    use std::collections::VecDeque;

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

        assert_eq!(guard_recovery(&refused, false), GuardRecovery::Restore);
    }

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

        assert_eq!(guard_recovery(&nothing_written, false), GuardRecovery::Restore);
        assert_eq!(guard_recovery(&something_written, false), GuardRecovery::StandDown);
    }

    #[test]
    fn a_step_that_already_finished_stands_the_guard_down_whatever_the_error_says() {
        let refused = anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges);

        assert_eq!(guard_recovery(&refused, false), GuardRecovery::Restore);
        assert_eq!(guard_recovery(&refused, true), GuardRecovery::StandDown);
    }

    #[test]
    fn only_a_snapshot_that_says_everything_is_off_reads_as_clean() {
        assert_eq!(classify_os_proxy_state(Ok(true)), OsProxyState::Clean);
        assert_eq!(classify_os_proxy_state(Ok(false)), OsProxyState::DirtyOrUnknown);
    }

    #[test]
    fn a_failed_read_never_counts_as_clean() {
        assert_eq!(
            classify_os_proxy_state(Err(anyhow::anyhow!("read failed"))),
            OsProxyState::DirtyOrUnknown
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

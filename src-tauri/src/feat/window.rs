use crate::config::Config;
use crate::core::lightweight;
use crate::core::notify::NoticeStatus;
use crate::core::{CoreManager, handle};
use crate::utils;
use crate::utils::window_manager::WindowManager;
use anyhow::{Context as _, anyhow};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use std::sync::mpsc::RecvTimeoutError;
use tokio::time::Duration;
#[cfg(target_os = "macos")]
use tokio::time::timeout;

#[cfg(target_os = "windows")]
const SESSION_ENDING_STOP_TIMEOUT: Duration = Duration::from_secs(2);
// TODO(macOS): a DNS script already running can outlast this and write after exit.
#[cfg(not(target_os = "windows"))]
const SESSION_ENDING_STOP_TIMEOUT: Duration = Duration::from_secs(3);

// Outlasts the script's own kill deadline.
#[cfg(target_os = "macos")]
const DNS_RESTORE_TIMEOUT: Duration =
    crate::utils::resolve::dns::DNS_SCRIPT_TIMEOUT.saturating_add(Duration::from_secs(1));
#[cfg(not(target_os = "macos"))]
const DNS_RESTORE_TIMEOUT: Duration = Duration::ZERO;

// Backstop for when the cleanup's own deadlines cannot fire.
const SESSION_ENDING_HARD_DEADLINE: Duration = SESSION_ENDING_STOP_TIMEOUT
    .saturating_add(DNS_RESTORE_TIMEOUT)
    .saturating_add(Duration::from_secs(1));

#[derive(Debug, Clone, Default)]
pub struct CleanupResult {
    pub all_success: bool,
    pub core_stopped: bool,
    /// Why the stop failed, for the cancelled-exit notice.
    pub stop_error: Option<String>,
}

const fn should_abort_exit_after_cleanup(core_stopped: bool) -> bool {
    !core_stopped
}

async fn run_exit_cleanup_transition<Stop, StopFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    if !stop_core().await {
        return CleanupResult::default();
    }
    CleanupResult {
        all_success: ancillary_cleanup().await,
        core_stopped: true,
        stop_error: None,
    }
}

async fn run_interactive_cleanup_transition<Stop, StopFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    run_exit_cleanup_transition(stop_core, ancillary_cleanup).await
}

async fn run_session_ending_cleanup_transition<Stop, StopFuture, DeadlineFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    stop_deadline: DeadlineFuture,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    DeadlineFuture: std::future::Future<Output = ()>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    run_exit_cleanup_transition(
        || async {
            tokio::select! {
                biased;
                stopped = stop_core() => stopped,
                () = stop_deadline => false,
            }
        },
        ancillary_cleanup,
    )
    .await
}

async fn restore_dns_after_core_stop() -> bool {
    #[cfg(target_os = "macos")]
    match timeout(DNS_RESTORE_TIMEOUT, crate::utils::resolve::dns::restore_public_dns()).await {
        Ok(Ok(())) => {
            logging!(debug, Type::Window, "DNS设置已恢复");
            true
        }
        Ok(Err(err)) => {
            logging!(warn, Type::Window, "恢复DNS设置失败: {err:#}");
            false
        }
        Err(_) => {
            logging!(warn, Type::Window, "恢复DNS设置超时");
            false
        }
    }
    #[cfg(not(target_os = "macos"))]
    true
}

pub async fn open_or_close_dashboard() {
    if lightweight::is_in_lightweight_mode() {
        let _ = lightweight::exit_lightweight_mode().await;
        return;
    }

    let result = WindowManager::toggle_main_window().await;
    logging!(info, Type::Window, "Window toggle result: {result:?}");
}

pub async fn quit() -> clash_verge_signal::ShutdownOutcome {
    logging!(debug, Type::System, "启动退出流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    Config::apply_all_and_save_file().await;

    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if should_abort_exit_after_cleanup(cleanup_result.core_stopped) {
        handle::Handle::global().clear_is_exiting();
        // A failed stop may still have marked the core stopped, and exit cleanup skipped the DNS restore.
        // A core that kept running keeps its DNS, whatever an unapplied config draft says.
        #[cfg(target_os = "macos")]
        {
            let manager = CoreManager::global();
            let _lifecycle = manager.lifecycle_lock.lock().await;
            if matches!(
                *manager.get_running_mode(),
                crate::core::manager::RunningMode::NotRunning
            ) {
                crate::utils::resolve::dns::sync_public_dns().await;
            }
        }
        handle::Handle::notice(
            NoticeStatus::AppQuitCoreStopFailed,
            cleanup_result.stop_error.unwrap_or_default(),
        );
        return clash_verge_signal::ShutdownOutcome::Canceled;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result.all_success { 0 } else { 1 });
    clash_verge_signal::ShutdownOutcome::Committed
}

pub async fn clean_async() -> CleanupResult {
    let stop_error = Mutex::new(None);
    let mut result = run_interactive_cleanup_transition(
        || async {
            logging!(debug, Type::System, "Stopping core for interactive quit or restart");
            match CoreManager::global().stop_core().await {
                Ok(()) => true,
                Err(error) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Controlled core stop failed; interactive quit or restart must remain cancelled: {error:#}"
                    );
                    *stop_error.lock() = Some(format!("{error:#}"));
                    false
                }
            }
        },
        restore_dns_after_core_stop,
    )
    .await;
    result.stop_error = stop_error.into_inner();

    logging!(
        info,
        Type::System,
        "Interactive cleanup complete - core stopped: {}, all cleanup successful: {}",
        result.core_stopped,
        result.all_success
    );

    result
}

pub fn clean_session_ending_with_hard_deadline() -> Option<CleanupResult> {
    match run_with_hard_deadline(clean_session_ending_best_effort, SESSION_ENDING_HARD_DEADLINE) {
        Ok(result) => Some(result),
        Err(error) => {
            logging!(
                warn,
                Type::System,
                "Session-ending cleanup abandoned; exiting without it: {error:#}"
            );
            None
        }
    }
}

/// Avoids the app runtime, whose workers may wait on the blocked main thread.
fn run_with_hard_deadline<F, Fut, T>(cleanup: F, deadline: Duration) -> anyhow::Result<T>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: std::future::Future<Output = T>,
    T: Send + 'static,
{
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("clash-verge-session-ending".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = sender.send(Err(error));
                    return;
                }
            };
            // Send first: dropping the runtime waits for blocking tasks.
            let _ = sender.send(Ok(runtime.block_on(cleanup())));
        })
        .context("failed to spawn the cleanup thread")?;
    match receiver.recv_timeout(deadline) {
        Ok(result) => result.context("failed to build the cleanup runtime"),
        Err(RecvTimeoutError::Timeout) => Err(anyhow!("still running after {} ms", deadline.as_millis())),
        Err(RecvTimeoutError::Disconnected) => Err(anyhow!("cleanup thread ended without a result")),
    }
}

async fn clean_session_ending_best_effort() -> CleanupResult {
    logging!(
        info,
        Type::System,
        "Starting bounded session-ending best-effort cleanup"
    );

    let result = run_session_ending_cleanup_transition(
        || async {
                    let _ = handle::Handle::mihomo().clear_all_ws_connections();
                    match CoreManager::global().stop_core().await {
                Ok(()) => {
                                    true
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Session-ending best-effort core stop failed; OS or session exit is already in progress: {error:#}"
                    );
                    false
                }
            }
        },
        async move {
            tokio::time::sleep(SESSION_ENDING_STOP_TIMEOUT).await;
            logging!(
                warn,
                Type::Window,
                "Session-ending best-effort core stop timed out after {} seconds; OS or session exit is already in progress",
                SESSION_ENDING_STOP_TIMEOUT.as_secs()
            );
        },
        restore_dns_after_core_stop,
    )
    .await;

    logging!(
        info,
        Type::System,
        "Session-ending best-effort cleanup finished - core stopped: {}, all cleanup successful: {}",
        result.core_stopped,
        result.all_success
    );

    result
}

#[cfg(target_os = "macos")]
pub async fn hide() {
    use crate::core::lightweight::add_light_weight_timer;

    let enable_auto_light_weight_mode = Config::verge()
        .await
        .data_arc()
        .enable_auto_light_weight_mode
        .unwrap_or(false);

    if enable_auto_light_weight_mode {
        add_light_weight_timer().await;
    }

    if let Some(window) = WindowManager::get_main_window()
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
    }
    handle::Handle::global().set_activation_policy_accessory();
}

#[cfg(test)]
mod tests {
    use super::{
        run_interactive_cleanup_transition, run_session_ending_cleanup_transition, run_with_hard_deadline,
        should_abort_exit_after_cleanup,
    };
    use parking_lot::Mutex;
    use std::{
        future::pending,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        task::Poll,
        time::Duration,
    };
    use tokio::sync::Barrier;

    struct CancellationProbe {
        cancelled: Arc<AtomicBool>,
        completed: Arc<AtomicBool>,
    }

    impl Drop for CancellationProbe {
        fn drop(&mut self) {
            if !self.completed.load(Ordering::Acquire) {
                self.cancelled.store(true, Ordering::Release);
            }
        }
    }

    #[test]
    fn exit_aborts_when_controlled_core_stop_fails() {
        assert!(should_abort_exit_after_cleanup(false));
        assert!(!should_abort_exit_after_cleanup(true));
    }

    #[test]
    fn hard_deadline_returns_while_cleanup_blocks_its_thread() {
        let (release, blocked) = mpsc::channel::<()>();

        let result = run_with_hard_deadline(
            move || async move {
                let _ = blocked.recv();
            },
            Duration::from_millis(50),
        );

        assert!(matches!(result, Err(error) if error.to_string().starts_with("still running")));
        drop(release);
    }

    #[test]
    fn hard_deadline_cleanup_runs_its_own_timers() {
        let result = run_with_hard_deadline(
            || async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                true
            },
            Duration::from_secs(5),
        );

        assert!(result.is_ok_and(|done| done));
    }

    #[tokio::test]
    async fn interactive_cleanup_awaits_barrier_controlled_stop_without_cancellation() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop_started = Arc::new(Barrier::new(2));
        let release_stop = Arc::new(Barrier::new(2));
        let stop_cancelled = Arc::new(AtomicBool::new(false));
        let stop_completed = Arc::new(AtomicBool::new(false));

        let mut cleanup = Box::pin(run_interactive_cleanup_transition(
            {
                let calls = Arc::clone(&calls);
                let stop_started = Arc::clone(&stop_started);
                let release_stop = Arc::clone(&release_stop);
                let stop_cancelled = Arc::clone(&stop_cancelled);
                let stop_completed = Arc::clone(&stop_completed);
                move || async move {
                    let _probe = CancellationProbe {
                        cancelled: stop_cancelled,
                        completed: Arc::clone(&stop_completed),
                    };
                    calls.lock().push("core_stop");
                    stop_started.wait().await;
                    release_stop.wait().await;
                    stop_completed.store(true, Ordering::Release);
                    true
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || async move {
                    calls.lock().push("ancillary_cleanup");
                    true
                }
            },
        ));

        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        stop_started.wait().await;
        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        assert!(!stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop"]);

        release_stop.wait().await;
        let result = cleanup.await;

        assert!(result.core_stopped);
        assert!(result.all_success);
        assert!(!stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop", "ancillary_cleanup"]);
    }

    #[tokio::test]
    async fn interactive_cleanup_does_not_run_ancillary_cleanup_after_stop_failure() {
        let calls = Mutex::new(Vec::new());

        let result = run_interactive_cleanup_transition(
            || async {
                calls.lock().push("core_stop");
                false
            },
            || async {
                calls.lock().push("ancillary_cleanup");
                true
            },
        )
        .await;

        assert!(!result.core_stopped);
        assert!(!result.all_success);
        assert_eq!(&*calls.lock(), &["core_stop"]);
    }

    #[tokio::test]
    async fn session_ending_cleanup_may_cancel_stop_and_skips_ancillary_after_timeout() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop_started = Arc::new(Barrier::new(2));
        let deadline_started = Arc::new(Barrier::new(2));
        let release_deadline = Arc::new(Barrier::new(2));
        let stop_cancelled = Arc::new(AtomicBool::new(false));
        let stop_completed = Arc::new(AtomicBool::new(false));

        let mut cleanup = Box::pin(run_session_ending_cleanup_transition(
            {
                let calls = Arc::clone(&calls);
                let stop_started = Arc::clone(&stop_started);
                let stop_cancelled = Arc::clone(&stop_cancelled);
                let stop_completed = Arc::clone(&stop_completed);
                move || async move {
                    let _probe = CancellationProbe {
                        cancelled: stop_cancelled,
                        completed: stop_completed,
                    };
                    calls.lock().push("core_stop");
                    stop_started.wait().await;
                    pending::<bool>().await
                }
            },
            {
                let deadline_started = Arc::clone(&deadline_started);
                let release_deadline = Arc::clone(&release_deadline);
                async move {
                    deadline_started.wait().await;
                    release_deadline.wait().await;
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || async move {
                    calls.lock().push("ancillary_cleanup");
                    true
                }
            },
        ));

        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        stop_started.wait().await;
        deadline_started.wait().await;
        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        assert!(!stop_cancelled.load(Ordering::Acquire));

        release_deadline.wait().await;
        let result = cleanup.await;

        assert!(!result.core_stopped);
        assert!(!result.all_success);
        assert!(stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop"]);
    }
}

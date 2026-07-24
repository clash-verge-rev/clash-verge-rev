use crate::config::Config;
use crate::core::{CoreManager, handle};
use crate::module::lightweight;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use tokio::time::Duration;
#[cfg(target_os = "macos")]
use tokio::time::timeout;

#[derive(Debug, Clone, Copy)]
pub struct CleanupResult {
    pub all_success: bool,
    pub core_stopped: bool,
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
        return CleanupResult {
            all_success: false,
            core_stopped: false,
        };
    }
    CleanupResult {
        all_success: ancillary_cleanup().await,
        core_stopped: true,
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
    match timeout(
        Duration::from_millis(1000),
        crate::utils::resolve::dns::restore_public_dns(),
    )
    .await
    {
        Ok(_) => {
            logging!(info, Type::Window, "DNS设置已恢复");
            true
        }
        Err(_) => {
            logging!(warn, Type::Window, "Warning: 恢复DNS设置超时");
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

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if should_abort_exit_after_cleanup(cleanup_result.core_stopped) {
        handle::Handle::global().clear_is_exiting();
        handle::Handle::notice_message("app_quit::core_stop_failed", "");
        return clash_verge_signal::ShutdownOutcome::Canceled;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result.all_success { 0 } else { 1 });
    clash_verge_signal::ShutdownOutcome::Committed
}

pub async fn clean_async() -> CleanupResult {
    logging!(
        info,
        Type::System,
        "Starting interactive cleanup; controlled core stop will be awaited to completion"
    );

    let result = run_interactive_cleanup_transition(
        || async {
            logging!(info, Type::System, "Stopping core for interactive quit or restart");
            match CoreManager::global().stop_core().await {
                Ok(()) => {
                    logging!(info, Type::Window, "Core stopped for interactive quit or restart");
                    true
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Controlled core stop failed; interactive quit or restart must remain cancelled: {error:#}"
                    );
                    false
                }
            }
        },
        restore_dns_after_core_stop,
    )
    .await;

    logging!(
        info,
        Type::System,
        "Interactive cleanup complete - core stopped: {}, all cleanup successful: {}",
        result.core_stopped,
        result.all_success
    );

    result
}

pub async fn clean_session_ending_best_effort() -> CleanupResult {
    #[cfg(target_os = "windows")]
    let stop_timeout = Duration::from_secs(2);
    #[cfg(not(target_os = "windows"))]
    let stop_timeout = Duration::from_secs(3);

    logging!(
        info,
        Type::System,
        "Starting bounded session-ending best-effort cleanup"
    );

    let result = run_session_ending_cleanup_transition(
        || async {
            logging!(info, Type::System, "Stopping core during session-ending best-effort cleanup");
            match CoreManager::global().stop_core().await {
                Ok(()) => {
                    logging!(info, Type::Window, "Core stopped during session-ending best-effort cleanup");
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
            tokio::time::sleep(stop_timeout).await;
            logging!(
                warn,
                Type::Window,
                "Session-ending best-effort core stop timed out after {} seconds; OS or session exit is already in progress",
                stop_timeout.as_secs()
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
    use crate::module::lightweight::add_light_weight_timer;

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
        run_interactive_cleanup_transition, run_session_ending_cleanup_transition, should_abort_exit_after_cleanup,
    };
    use parking_lot::Mutex;
    use std::{
        future::pending,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        task::Poll,
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

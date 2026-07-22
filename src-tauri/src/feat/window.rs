use crate::config::Config;
use crate::core::{CoreManager, handle};
use crate::module::lightweight;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use tokio::time::{Duration, timeout};

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

pub async fn open_or_close_dashboard() {
    if lightweight::is_in_lightweight_mode() {
        let _ = lightweight::exit_lightweight_mode().await;
        return;
    }

    let result = WindowManager::toggle_main_window().await;
    logging!(info, Type::Window, "Window toggle result: {result:?}");
}

pub async fn quit() {
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
        handle::Handle::notice_message(
            "set_config::error",
            "Failed to stop the core safely; quit was cancelled",
        );
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result.all_success { 0 } else { 1 });
}

pub async fn clean_async() -> CleanupResult {
    logging!(info, Type::System, "开始执行异步清理操作...");

    let result = run_exit_cleanup_transition(
        || async {
            #[cfg(target_os = "macos")]
            {
                logging!(info, Type::System, "stop core");
                return match CoreManager::global().stop_core().await {
                    Ok(()) => {
                        logging!(info, Type::Window, "core已停止");
                        true
                    }
                    Err(error) => {
                        logging!(warn, Type::Window, "Warning: 安全停止core失败，取消退出: {error:#}");
                        false
                    }
                };
            }

            #[cfg(not(target_os = "macos"))]
            {
                #[cfg(target_os = "windows")]
                let stop_timeout = Duration::from_secs(2);
                #[cfg(not(target_os = "windows"))]
                let stop_timeout = Duration::from_secs(3);

                logging!(info, Type::System, "stop core");
                match timeout(stop_timeout, CoreManager::global().stop_core()).await {
                    Ok(Ok(())) => {
                        logging!(info, Type::Window, "core已停止");
                        true
                    }
                    Ok(Err(error)) => {
                        logging!(warn, Type::Window, "Warning: 停止core失败: {error:#}");
                        false
                    }
                    Err(_) => {
                        logging!(
                            warn,
                            Type::Window,
                            "Warning: 停止core超时（可能系统正在关机），继续退出"
                        );
                        false
                    }
                }
            }
        },
        || async {
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
        },
    )
    .await;

    logging!(
        info,
        Type::System,
        "异步关闭操作完成 - 核心: {}, 总体: {}",
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
    use super::{run_exit_cleanup_transition, should_abort_exit_after_cleanup};
    use parking_lot::Mutex;

    #[test]
    fn exit_aborts_when_controlled_core_stop_fails() {
        assert!(should_abort_exit_after_cleanup(false));
        assert!(!should_abort_exit_after_cleanup(true));
    }

    #[tokio::test]
    async fn exit_cleanup_does_not_run_ancillary_cleanup_after_stop_failure() {
        let calls = Mutex::new(Vec::new());

        let result = run_exit_cleanup_transition(
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
}

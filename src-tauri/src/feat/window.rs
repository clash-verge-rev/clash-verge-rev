use crate::config::Config;
use crate::core::{CoreManager, handle, sysopt};
use crate::module::lightweight;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use tokio::time::{Duration, timeout};

/// Public API: open or close the dashboard
pub async fn open_or_close_dashboard() {
    open_or_close_dashboard_internal().await
}

/// Internal implementation for opening/closing dashboard
async fn open_or_close_dashboard_internal() {
    let _ = lightweight::exit_lightweight_mode().await;
    let result = WindowManager::toggle_main_window().await;
    logging!(info, Type::Window, "Window toggle result: {result:?}");
}

pub async fn quit() {
    logging!(debug, Type::System, "启动退出流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    utils::server::shutdown_embedded_server();
    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result { 0 } else { 1 }
    );

    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result { 0 } else { 1 });
}

pub async fn clean_async() -> bool {
    logging!(info, Type::System, "开始执行异步清理操作...");

    // 重置系统代理
    let proxy_task = tokio::task::spawn(async {
        let sys_proxy_enabled = Config::verge().await.data_arc().enable_system_proxy.unwrap_or(false);
        if !sys_proxy_enabled {
            logging!(info, Type::Window, "系统代理未启用，跳过重置");
            return true;
        }

        logging!(info, Type::Window, "开始重置系统代理...");
        match timeout(Duration::from_millis(1500), sysopt::Sysopt::global().reset_sysproxy()).await {
            Ok(Ok(_)) => {
                logging!(info, Type::Window, "系统代理已重置");
                true
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Window, "Warning: 重置系统代理失败: {e}");
                false
            }
            Err(_) => {
                logging!(warn, Type::Window, "Warning: 重置系统代理超时，继续退出");
                false
            }
        }
    });

    // 关闭 Tun 模式 + 停止核心服务
    let core_task = tokio::task::spawn(async {
        logging!(info, Type::System, "disable tun");
        let tun_enabled = Config::verge().await.data_arc().enable_tun_mode.unwrap_or(false);
        if tun_enabled {
            let disable_tun = serde_json::json!({ "tun": { "enable": false } });

            logging!(info, Type::System, "send disable tun request to mihomo");
            match timeout(
                Duration::from_millis(1000),
                handle::Handle::mihomo().await.patch_base_config(&disable_tun),
            )
            .await
            {
                Ok(Ok(_)) => {
                    logging!(info, Type::Window, "TUN模式已禁用");
                }
                Ok(Err(e)) => {
                    logging!(warn, Type::Window, "Warning: 禁用TUN模式失败: {e}");
                }
                Err(_) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Warning: 禁用TUN模式超时（可能系统正在关机），继续退出流程"
                    );
                }
            }
        }

        #[cfg(target_os = "windows")]
        let stop_timeout = Duration::from_secs(2);
        #[cfg(not(target_os = "windows"))]
        let stop_timeout = Duration::from_secs(3);

        logging!(info, Type::System, "stop core");
        match timeout(stop_timeout, CoreManager::global().stop_core()).await {
            Ok(_) => {
                logging!(info, Type::Window, "core已停止");
                true
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
    });

    // DNS恢复（仅macOS）
    let dns_task = tokio::task::spawn(async {
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
    });

    // 并行执行清理任务
    let (proxy_result, core_result, dns_result) = tokio::join!(proxy_task, core_task, dns_task);

    let proxy_success = proxy_result.unwrap_or_default();
    let core_success = core_result.unwrap_or_default();
    let dns_success = dns_result.unwrap_or_default();

    let all_success = proxy_success && core_success && dns_success;

    logging!(
        info,
        Type::System,
        "异步关闭操作完成 - 代理: {}, 核心: {}, DNS: {}, 总体: {}",
        proxy_success,
        core_success,
        dns_success,
        all_success
    );

    all_success
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

    if let Some(window) = handle::Handle::get_window()
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
    }
    handle::Handle::global().set_activation_policy_accessory();
}

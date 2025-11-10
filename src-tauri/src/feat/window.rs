use crate::config::Config;
use crate::core::event_driven_proxy::EventDrivenProxyManager;
use crate::core::{CoreManager, handle, sysopt};
use crate::utils;
use crate::utils::window_manager::WindowManager;
use crate::{logging, module::lightweight, utils::logging::Type};

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
    utils::server::shutdown_embedded_server();

    // 获取应用句柄并设置退出标志
    let app_handle = handle::Handle::app_handle();
    handle::Handle::global().set_is_exiting();
    EventDrivenProxyManager::global().notify_app_stopping();

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result { 0 } else { 1 }
    );
    app_handle.exit(if cleanup_result { 0 } else { 1 });
}

pub async fn clean_async() -> bool {
    use tokio::time::{Duration, timeout};

    logging!(info, Type::System, "开始执行异步清理操作...");

    // 1. 处理TUN模式
    let tun_task = async {
        let tun_enabled = Config::verge()
            .await
            .data_arc()
            .enable_tun_mode
            .unwrap_or(false);

        if !tun_enabled {
            return true;
        }

        let disable_tun = serde_json::json!({ "tun": { "enable": false } });

        match timeout(
            Duration::from_millis(1000),
            handle::Handle::mihomo()
                .await
                .patch_base_config(&disable_tun),
        )
        .await
        {
            Ok(Ok(_)) => {
                logging!(info, Type::Window, "TUN模式已禁用");
                true
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Window, "Warning: 禁用TUN模式失败: {e}");
                // 超时不阻塞退出
                true
            }
            Err(_) => {
                logging!(
                    warn,
                    Type::Window,
                    "Warning: 禁用TUN模式超时（可能系统正在关机），继续退出流程"
                );
                true
            }
        }
    };

    // 2. 系统代理重置
    let proxy_task = async {
        #[cfg(target_os = "windows")]
        {
            use sysproxy::{Autoproxy, Sysproxy};
            use winapi::um::winuser::{GetSystemMetrics, SM_SHUTTINGDOWN};

            // 检查系统代理是否开启
            let sys_proxy_enabled = Config::verge()
                .await
                .data_arc()
                .enable_system_proxy
                .unwrap_or(false);

            if !sys_proxy_enabled {
                logging!(info, Type::Window, "系统代理未启用，跳过重置");
                return true;
            }

            // 检查是否正在关机
            let is_shutting_down = unsafe { GetSystemMetrics(SM_SHUTTINGDOWN) != 0 };

            if is_shutting_down {
                // sysproxy-rs 操作注册表(避免.exe的dll错误)
                logging!(
                    info,
                    Type::Window,
                    "检测到正在关机，syspro-rs操作注册表关闭系统代理"
                );

                match Sysproxy::get_system_proxy() {
                    Ok(mut sysproxy) => {
                        sysproxy.enable = false;
                        if let Err(e) = sysproxy.set_system_proxy() {
                            logging!(warn, Type::Window, "Warning: 关机时关闭系统代理失败: {e}");
                        } else {
                            logging!(info, Type::Window, "系统代理已关闭（通过注册表）");
                        }
                    }
                    Err(e) => {
                        logging!(warn, Type::Window, "Warning: 关机时获取代理设置失败: {e}");
                    }
                }

                // 关闭自动代理配置
                if let Ok(mut autoproxy) = Autoproxy::get_auto_proxy() {
                    autoproxy.enable = false;
                    let _ = autoproxy.set_auto_proxy();
                }

                return true;
            }

            // 正常退出：使用 sysproxy.exe 重置代理
            logging!(info, Type::Window, "sysproxy.exe重置系统代理");

            match timeout(
                Duration::from_secs(2),
                sysopt::Sysopt::global().reset_sysproxy(),
            )
            .await
            {
                Ok(Ok(_)) => {
                    logging!(info, Type::Window, "系统代理已重置");
                    true
                }
                Ok(Err(e)) => {
                    logging!(warn, Type::Window, "Warning: 重置系统代理失败: {e}");
                    true
                }
                Err(_) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Warning: 重置系统代理超时，继续退出流程"
                    );
                    true
                }
            }
        }

        // 非 Windows 平台：正常重置代理
        #[cfg(not(target_os = "windows"))]
        {
            let sys_proxy_enabled = Config::verge()
                .await
                .data_arc()
                .enable_system_proxy
                .unwrap_or(false);

            if !sys_proxy_enabled {
                logging!(info, Type::Window, "系统代理未启用，跳过重置");
                return true;
            }

            logging!(info, Type::Window, "开始重置系统代理...");

            match timeout(
                Duration::from_millis(1500),
                sysopt::Sysopt::global().reset_sysproxy(),
            )
            .await
            {
                Ok(Ok(_)) => {
                    logging!(info, Type::Window, "系统代理已重置");
                    true
                }
                Ok(Err(e)) => {
                    logging!(warn, Type::Window, "Warning: 重置系统代理失败: {e}");
                    true
                }
                Err(_) => {
                    logging!(warn, Type::Window, "Warning: 重置系统代理超时，继续退出");
                    true
                }
            }
        }
    };

    // 3. 核心服务停止
    let core_task = async {
        #[cfg(target_os = "windows")]
        let stop_timeout = Duration::from_secs(2);
        #[cfg(not(target_os = "windows"))]
        let stop_timeout = Duration::from_secs(3);

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
                true
            }
        }
    };

    // 4. DNS恢复（仅macOS）
    #[cfg(target_os = "macos")]
    let dns_task = async {
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
    };

    #[cfg(not(target_os = "macos"))]
    let dns_task = async { true };

    let tun_success = tun_task.await;
    // 并行执行清理任务
    let (proxy_success, core_success, dns_success) = tokio::join!(proxy_task, core_task, dns_task);

    let all_success = tun_success && proxy_success && core_success && dns_success;

    logging!(
        info,
        Type::System,
        "异步关闭操作完成 - TUN: {}, 代理: {}, 核心: {}, DNS: {}, 总体: {}",
        tun_success,
        proxy_success,
        core_success,
        dns_success,
        all_success
    );

    all_success
}

pub fn clean() -> bool {
    use crate::process::AsyncHandler;

    let (tx, rx) = std::sync::mpsc::channel();

    AsyncHandler::spawn(move || async move {
        logging!(info, Type::System, "开始执行关闭操作...");

        // 使用已有的异步清理函数
        let cleanup_result = clean_async().await;

        let _ = tx.send(cleanup_result);
    });

    #[cfg(target_os = "windows")]
    let total_timeout = std::time::Duration::from_secs(5);
    #[cfg(not(target_os = "windows"))]
    let total_timeout = std::time::Duration::from_secs(8);

    match rx.recv_timeout(total_timeout) {
        Ok(result) => {
            logging!(info, Type::System, "关闭操作完成，结果: {}", result);
            result
        }
        Err(_) => {
            logging!(
                warn,
                Type::System,
                "清理操作超时(可能正在关机)，返回成功避免阻塞"
            );
            true
        }
    }
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

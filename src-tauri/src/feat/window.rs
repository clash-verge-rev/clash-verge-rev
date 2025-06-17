#[cfg(target_os = "macos")]
use crate::AppHandleManager;
use crate::{
    config::Config,
    core::{handle, sysopt, CoreManager},
    logging,
    module::mihomo::MihomoManager,
    utils::logging::Type,
};

/// Open or close the dashboard window
#[allow(dead_code)]
pub fn open_or_close_dashboard() {
    use crate::utils::window_manager::WindowManager;

    log::info!(target: "app", "Attempting to open/close dashboard");

    // 检查是否在轻量模式下
    if crate::module::lightweight::is_in_lightweight_mode() {
        log::info!(target: "app", "Currently in lightweight mode, exiting lightweight mode");
        crate::module::lightweight::exit_lightweight_mode();
        log::info!(target: "app", "Creating new window after exiting lightweight mode");
        let result = WindowManager::show_main_window();
        log::info!(target: "app", "Window operation result: {:?}", result);
        return;
    }

    // 使用统一的窗口管理器切换窗口状态
    let result = WindowManager::toggle_main_window();
    log::info!(target: "app", "Window toggle result: {:?}", result);
}

/// 异步优化的应用退出函数
pub fn quit() {
    use crate::process::AsyncHandler;
    logging!(debug, Type::System, true, "启动退出流程");

    // 获取应用句柄并设置退出标志
    let app_handle = handle::Handle::global().app_handle().unwrap();
    handle::Handle::global().set_is_exiting();

    // 优先关闭窗口，提供立即反馈
    if let Some(window) = handle::Handle::global().get_window() {
        let _ = window.hide();
        log::info!(target: "app", "窗口已隐藏");
    }

    // 使用异步任务处理资源清理，避免阻塞
    AsyncHandler::spawn(move || async move {
        logging!(info, Type::System, true, "开始异步清理资源");
        let cleanup_result = clean_async().await;

        logging!(
            info,
            Type::System,
            true,
            "资源清理完成，退出代码: {}",
            if cleanup_result { 0 } else { 1 }
        );
        app_handle.exit(if cleanup_result { 0 } else { 1 });
    });
}

async fn clean_async() -> bool {
    use tokio::time::{timeout, Duration};

    logging!(info, Type::System, true, "开始执行异步清理操作...");

    // 1. 处理TUN模式
    let tun_task = async {
        if Config::verge().data().enable_tun_mode.unwrap_or(false) {
            let disable_tun = serde_json::json!({
                "tun": {
                    "enable": false
                }
            });
            match timeout(
                Duration::from_secs(2),
                MihomoManager::global().patch_configs(disable_tun),
            )
            .await
            {
                Ok(_) => {
                    log::info!(target: "app", "TUN模式已禁用");
                    true
                }
                Err(_) => {
                    log::warn!(target: "app", "禁用TUN模式超时");
                    false
                }
            }
        } else {
            true
        }
    };

    // 2. 系统代理重置
    let proxy_task = async {
        match timeout(
            Duration::from_secs(3),
            sysopt::Sysopt::global().reset_sysproxy(),
        )
        .await
        {
            Ok(_) => {
                log::info!(target: "app", "系统代理已重置");
                true
            }
            Err(_) => {
                log::warn!(target: "app", "重置系统代理超时");
                false
            }
        }
    };

    // 3. 核心服务停止
    let core_task = async {
        match timeout(Duration::from_secs(3), CoreManager::global().stop_core()).await {
            Ok(_) => {
                log::info!(target: "app", "核心服务已停止");
                true
            }
            Err(_) => {
                log::warn!(target: "app", "停止核心服务超时");
                false
            }
        }
    };

    // 4. DNS恢复（仅macOS）
    #[cfg(target_os = "macos")]
    let dns_task = async {
        match timeout(
            Duration::from_millis(1000),
            crate::utils::resolve::restore_public_dns(),
        )
        .await
        {
            Ok(_) => {
                log::info!(target: "app", "DNS设置已恢复");
                true
            }
            Err(_) => {
                log::warn!(target: "app", "恢复DNS设置超时");
                false
            }
        }
    };

    // 并行执行所有清理任务
    let (tun_success, proxy_success, core_success) = tokio::join!(tun_task, proxy_task, core_task);

    #[cfg(target_os = "macos")]
    let dns_success = dns_task.await;
    #[cfg(not(target_os = "macos"))]
    let dns_success = true;

    let all_success = tun_success && proxy_success && core_success && dns_success;

    logging!(
        info,
        Type::System,
        true,
        "异步清理操作完成 - TUN: {}, 代理: {}, 核心: {}, DNS: {}, 总体: {}",
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
        logging!(info, Type::System, true, "开始执行清理操作...");

        // 使用已有的异步清理函数
        let cleanup_result = clean_async().await;

        // 发送结果
        let _ = tx.send(cleanup_result);
    });

    match rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(result) => {
            logging!(info, Type::System, true, "清理操作完成，结果: {}", result);
            result
        }
        Err(_) => {
            logging!(
                warn,
                Type::System,
                true,
                "清理操作超时，返回成功状态避免阻塞"
            );
            true
        }
    }
}

#[cfg(target_os = "macos")]
pub fn hide() {
    use crate::module::lightweight::add_light_weight_timer;

    let enable_auto_light_weight_mode = Config::verge()
        .data()
        .enable_auto_light_weight_mode
        .unwrap_or(false);

    if enable_auto_light_weight_mode {
        add_light_weight_timer();
    }

    if let Some(window) = handle::Handle::global().get_window() {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    }
    AppHandleManager::global().set_activation_policy_accessory();
}

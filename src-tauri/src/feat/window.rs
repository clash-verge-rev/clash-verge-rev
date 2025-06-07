#[cfg(target_os = "macos")]
use crate::AppHandleManager;
use crate::{
    config::Config,
    core::{handle, sysopt, CoreManager},
    module::mihomo::MihomoManager,
    utils::resolve,
};

/// Open or close the dashboard window
#[allow(dead_code)]
pub fn open_or_close_dashboard() {
    println!("Attempting to open/close dashboard");
    log::info!(target: "app", "Attempting to open/close dashboard");

    if let Some(window) = handle::Handle::global().get_window() {
        println!("Found existing window");
        log::info!(target: "app", "Found existing window");

        // 如果窗口存在，则切换其显示状态
        match window.is_visible() {
            Ok(visible) => {
                println!("Window visibility status: {}", visible);
                log::info!(target: "app", "Window visibility status: {}", visible);

                if visible {
                    println!("Attempting to hide window");
                    log::info!(target: "app", "Attempting to hide window");
                    let _ = window.hide();
                } else {
                    println!("Attempting to show and focus window");
                    log::info!(target: "app", "Attempting to show and focus window");
                    if window.is_minimized().unwrap_or(false) {
                        let _ = window.unminimize();
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            Err(e) => {
                println!("Failed to get window visibility: {:?}", e);
                log::error!(target: "app", "Failed to get window visibility: {:?}", e);
            }
        }
    } else {
        println!("No existing window found, creating new window");
        log::info!(target: "app", "No existing window found, creating new window");
        resolve::create_window(true);
    }
}

/// 优化的应用退出函数
pub fn quit() {
    log::debug!(target: "app", "启动退出流程");

    // 获取应用句柄并设置退出标志
    let app_handle = handle::Handle::global().app_handle().unwrap();
    handle::Handle::global().set_is_exiting();

    // 优先关闭窗口，提供立即反馈
    if let Some(window) = handle::Handle::global().get_window() {
        let _ = window.hide();
    }

    // 在单独线程中处理资源清理，避免阻塞主线程
    std::thread::spawn(move || {
        let cleanup_result = clean();
        app_handle.exit(match cleanup_result {
            true => 0,
            false => 1,
        });
    });
}

pub fn clean() -> bool {
    use tokio::time::{timeout, Duration};
    let rt = tokio::runtime::Runtime::new().unwrap();
    let cleanup_result = rt.block_on(async {
        // 1. 处理TUN模式
        let tun_success = if Config::verge().data().enable_tun_mode.unwrap_or(false) {
            let disable_tun = serde_json::json!({
                "tun": {
                    "enable": false
                }
            });
            timeout(
                Duration::from_secs(1),
                MihomoManager::global().patch_configs(disable_tun),
            )
            .await
            .is_ok()
        } else {
            true
        };

        // 2. 顺序执行关键清理
        let proxy_res = timeout(
            Duration::from_secs(1),
            sysopt::Sysopt::global().reset_sysproxy(),
        )
        .await;

        let core_res = timeout(Duration::from_secs(1), CoreManager::global().stop_core()).await;

        // 3. 平台特定清理
        #[cfg(target_os = "macos")]
        let _dns_res = timeout(Duration::from_millis(500), resolve::restore_public_dns()).await;

        tun_success && proxy_res.is_ok() && core_res.is_ok()
    });
    cleanup_result
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

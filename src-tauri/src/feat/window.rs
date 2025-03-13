use crate::{
    config::Config,
    core::{handle, sysopt, CoreManager},
    module::mihomo::MihomoManager,
    utils::resolve,
};
use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

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
        resolve::create_window();
    }
}

/// Setup window state monitor to save window position and size in real-time
pub fn setup_window_state_monitor(app_handle: &tauri::AppHandle) {
    let window = app_handle.get_webview_window("main").unwrap();
    let app_handle_clone = app_handle.clone();

    // 监听窗口移动事件
    let app_handle_move = app_handle_clone.clone();
    window.on_window_event(move |event| {
        match event {
            // 窗口移动时保存状态
            tauri::WindowEvent::Moved(_) => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            }
            // 窗口调整大小时保存状态
            tauri::WindowEvent::Resized(_) => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            }
            // 其他可能改变窗口状态的事件
            tauri::WindowEvent::ScaleFactorChanged { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            }
            // 窗口关闭时保存
            tauri::WindowEvent::CloseRequested { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            }
            _ => {}
        }
    });
}

/// 优化的应用退出函数
pub fn quit(code: Option<i32>) {
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
        // 使用tokio运行时执行异步清理任务
        tauri::async_runtime::block_on(async {
            // 使用超时机制处理清理操作
            use tokio::time::{timeout, Duration};

            // 1. 直接关闭TUN模式 (优先处理，通常最容易卡住)
            if Config::verge().data().enable_tun_mode.unwrap_or(false) {
                let disable = serde_json::json!({
                    "tun": {
                        "enable": false
                    }
                });

                // 设置1秒超时
                let _ = timeout(
                    Duration::from_secs(1),
                    MihomoManager::global().patch_configs(disable),
                )
                .await;
            }

            // 2. 并行处理系统代理和核心进程清理
            let proxy_future = timeout(
                Duration::from_secs(1),
                sysopt::Sysopt::global().reset_sysproxy(),
            );

            let core_future = timeout(Duration::from_secs(1), CoreManager::global().stop_core());

            // 同时等待两个任务完成
            let _ = futures::join!(proxy_future, core_future);

            // 3. 处理macOS特定清理
            #[cfg(target_os = "macos")]
            {
                let _ = timeout(Duration::from_millis(500), resolve::restore_public_dns()).await;
            }
        });

        // 无论清理结果如何，确保应用退出
        app_handle.exit(code.unwrap_or(0));
    });
}

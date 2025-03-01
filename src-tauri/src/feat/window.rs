use crate::utils::resolve;
use crate::core::handle;
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
            },
            // 窗口调整大小时保存状态
            tauri::WindowEvent::Resized(_) => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            // 其他可能改变窗口状态的事件
            tauri::WindowEvent::ScaleFactorChanged { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            // 窗口关闭时保存
            tauri::WindowEvent::CloseRequested { .. } => {
                let _ = app_handle_move.save_window_state(StateFlags::all());
            },
            _ => {}
        }
    });
}

/// Quit the application
pub fn quit(code: Option<i32>) {
    let app_handle = handle::Handle::global().app_handle().unwrap();
    handle::Handle::global().set_is_exiting();
    super::toggle_tun_mode(Some(true));
    resolve::resolve_reset();
    let _ = handle::Handle::global().get_window().unwrap().close();
    app_handle.exit(code.unwrap_or(0));
}

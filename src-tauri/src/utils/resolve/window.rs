use tauri::WebviewWindow;

use crate::{
    core::handle,
    logging, logging_error,
    utils::{
        logging::Type,
        resolve::window_script::{INITIAL_LOADING_OVERLAY, WINDOW_INITIAL_SCRIPT},
    },
};

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 700.0;

const MINIMAL_WIDTH: f64 = 520.0;
const MINIMAL_HEIGHT: f64 = 520.0;

/// 构建新的 WebView 窗口
pub fn build_new_window() -> Result<WebviewWindow, String> {
    let app_handle = handle::Handle::global().app_handle().ok_or_else(|| {
        logging!(
            error,
            Type::Window,
            true,
            "无法获取app_handle，窗口创建失败"
        );
        "无法获取app_handle".to_string()
    })?;

    match tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main", /* the unique window label */
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .center()
    .decorations(true)
    .fullscreen(false)
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MINIMAL_WIDTH, MINIMAL_HEIGHT)
    .visible(true) // 立即显示窗口，避免用户等待
    .initialization_script(WINDOW_INITIAL_SCRIPT)
    .build()
    {
        Ok(window) => {
            logging_error!(Type::Window, true, window.eval(INITIAL_LOADING_OVERLAY));
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

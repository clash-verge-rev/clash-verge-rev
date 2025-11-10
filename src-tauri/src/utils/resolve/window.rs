use tauri::WebviewWindow;

use crate::{
    config::Config,
    core::handle,
    logging_error,
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
pub async fn build_new_window() -> Result<WebviewWindow, String> {
    let app_handle = handle::Handle::app_handle();

    let config = Config::verge().await;
    let latest = config.latest_arc();
    let start_page = latest.start_page.as_deref().unwrap_or("/");

    match tauri::WebviewWindowBuilder::new(
        app_handle,
        "main", /* the unique window label */
        tauri::WebviewUrl::App(start_page.into()),
    )
    .title("Clash Verge")
    .center()
    // Using WindowManager::prefer_system_titlebar to control if show system built-in titlebar
    // .decorations(true)
    .fullscreen(false)
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MINIMAL_WIDTH, MINIMAL_HEIGHT)
    .visible(true) // 立即显示窗口，避免用户等待
    .initialization_script(WINDOW_INITIAL_SCRIPT)
    .build()
    {
        Ok(window) => {
            logging_error!(Type::Window, window.eval(INITIAL_LOADING_OVERLAY));
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

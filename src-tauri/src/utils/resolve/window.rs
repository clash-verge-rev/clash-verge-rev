use tauri::utils::config::Color;
use tauri::{Theme, WebviewWindow};

use crate::{
    config::Config,
    core::handle,
    utils::resolve::window_script::{INITIAL_LOADING_OVERLAY, build_window_initial_script},
};
use clash_verge_logging::{Type, logging_error};

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
    let initial_theme_mode = match latest.theme_mode.as_deref() {
        Some("dark") => "dark",
        Some("light") => "light",
        _ => "system",
    };
    let initial_script = build_window_initial_script(initial_theme_mode);

    let resolved_theme = match initial_theme_mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };

    let background_color = match resolved_theme {
        Some(Theme::Dark) => Some(Color(26, 26, 26, 255)), // #1a1a1a
        Some(Theme::Light) => Some(Color(245, 245, 245, 255)), // #f5f5f5
        _ => None,
    };

    let mut builder = tauri::WebviewWindowBuilder::new(
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
    .initialization_script(&initial_script);

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    if let Some(color) = background_color {
        builder = builder.background_color(color);
    }

    match builder.build() {
        Ok(window) => {
            logging_error!(Type::Window, window.eval(INITIAL_LOADING_OVERLAY));
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

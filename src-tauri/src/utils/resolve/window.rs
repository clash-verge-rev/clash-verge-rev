use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::utils::config::Color;
use tauri::{Theme, WebviewWindow, Monitor};
use std::path::PathBuf;

use crate::{
    config::Config,
    core::handle,
    utils::{dirs, resolve::window_script::{INITIAL_LOADING_OVERLAY, build_window_initial_script}},
};
use clash_verge_logging::{Type, logging, logging_error};

const DARK_BACKGROUND_COLOR: Color = Color(46, 48, 61, 255); // #2E303D
const LIGHT_BACKGROUND_COLOR: Color = Color(245, 245, 245, 255); // #F5F5F5
const DARK_BACKGROUND_HEX: &str = "#2E303D";
const LIGHT_BACKGROUND_HEX: &str = "#F5F5F5";

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 700.0;

const MINIMAL_WIDTH: f64 = 520.0;
const MINIMAL_HEIGHT: f64 = 520.0;

/// 窗口状态信息（从 window_state.json 读取）
#[derive(Debug, Clone, serde::Deserialize)]
struct WindowState {
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
}

/// 检查窗口状态文件是否存在，并读取保存的窗口状态
fn get_saved_window_state() -> Option<WindowState> {
    let app_dir = dirs::app_home_dir().ok()?;
    let state_path: PathBuf = app_dir.join(crate::constants::files::WINDOW_STATE);
    
    if !state_path.exists() {
        logging!(info, Type::Window, "窗口状态文件不存在: {:?}", state_path);
        return None;
    }
    
    match std::fs::read_to_string(&state_path) {
        Ok(content) => {
            match serde_json::from_str::<serde_json::Value>(&content) {
                Ok(json) => {
                    // 尝试从 JSON 中提取 main 窗口的状态
                    if let Some(main_state) = json.get("main") {
                        match serde_json::from_value::<WindowState>(main_state.clone()) {
                            Ok(state) => {
                                logging!(
                                    info,
                                    Type::Window,
                                    "读取到保存的窗口状态: x={:?}, y={:?}, width={:?}, height={:?}",
                                    state.x,
                                    state.y,
                                    state.width,
                                    state.height
                                );
                                Some(state)
                            }
                            Err(e) => {
                                logging!(
                                    warn,
                                    Type::Window,
                                    "解析窗口状态失败: {}",
                                    e
                                );
                                None
                            }
                        }
                    } else {
                        logging!(info, Type::Window, "窗口状态文件中没有 main 窗口的记录");
                        None
                    }
                }
                Err(e) => {
                    logging!(warn, Type::Window, "解析窗口状态 JSON 失败: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            logging!(warn, Type::Window, "读取窗口状态文件失败: {}", e);
            None
        }
    }
}

/// 验证窗口位置是否在有效的监视器范围内
/// 如果位置无效（例如监视器已断开），返回 false
fn validate_window_position(x: i32, y: i32, width: f64, height: f64, monitors: &[Monitor]) -> bool {
    if monitors.is_empty() {
        logging!(warn, Type::Window, "没有检测到任何监视器");
        return false;
    }
    
    // 计算窗口中心点
    let window_center_x = x + (width / 2.0) as i32;
    let window_center_y = y + (height / 2.0) as i32;
    
    // 检查窗口中心点是否在任何监视器范围内
    for monitor in monitors {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        
        let monitor_x = monitor_pos.x;
        let monitor_y = monitor_pos.y;
        let monitor_width = monitor_size.width as i32;
        let monitor_height = monitor_size.height as i32;
        
        // 检查窗口中心是否在监视器范围内
        if window_center_x >= monitor_x
            && window_center_x < monitor_x + monitor_width
            && window_center_y >= monitor_y
            && window_center_y < monitor_y + monitor_height
        {
            logging!(
                info,
                Type::Window,
                "窗口位置有效: 中心点({}, {}) 在监视器 {} 范围内",
                window_center_x,
                window_center_y,
                monitor.name().unwrap_or("Unknown".to_string())
            );
            return true;
        }
    }
    
    logging!(
        warn,
        Type::Window,
        "窗口位置无效: 中心点({}, {}) 不在任何监视器范围内",
        window_center_x,
        window_center_y
    );
    false
}

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

    let resolved_theme = match initial_theme_mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };

    let prefers_dark_background = match resolved_theme {
        Some(Theme::Dark) => true,
        Some(Theme::Light) => false,
        _ => !matches!(detect_system_theme().ok(), Some(SystemTheme::Light)),
    };

    let background_color = if prefers_dark_background {
        DARK_BACKGROUND_COLOR
    } else {
        LIGHT_BACKGROUND_COLOR
    };

    let initial_script = build_window_initial_script(
        initial_theme_mode,
        DARK_BACKGROUND_HEX,
        LIGHT_BACKGROUND_HEX,
    );

    // 检查是否存在保存的窗口状态
    let saved_state = get_saved_window_state();
    let (should_center, window_width, window_height) = if let Some(ref state) = saved_state {
        // 如果有保存的状态，检查位置是否有效
        if let (Some(x), Some(y), Some(width), Some(height)) = (state.x, state.y, state.width, state.height) {
            // 获取所有监视器
            let monitors = app_handle.available_monitors().map_err(|e| {
                logging!(warn, Type::Window, "获取监视器列表失败: {}", e);
                e.to_string()
            })?;
            
            // 验证保存的位置是否有效
            let is_valid = validate_window_position(x, y, width, height, &monitors);
            
            if is_valid {
                logging!(info, Type::Window, "使用保存的窗口位置和大小");
                (false, width, height) // 不需要居中，让插件恢复保存的位置和大小
            } else {
                logging!(
                    info,
                    Type::Window,
                    "保存的窗口位置无效（监视器可能已断开），将使用保存的大小在主监视器居中"
                );
                (true, width, height) // 需要居中，但保留保存的大小
            }
        } else {
            logging!(info, Type::Window, "保存的窗口状态不完整，将使用默认大小并居中显示");
            (true, DEFAULT_WIDTH, DEFAULT_HEIGHT)
        }
    } else {
        logging!(info, Type::Window, "没有保存的窗口状态，将使用默认大小并居中显示");
        (true, DEFAULT_WIDTH, DEFAULT_HEIGHT)
    };

    let mut builder = tauri::WebviewWindowBuilder::new(
        app_handle,
        "main", /* the unique window label */
        tauri::WebviewUrl::App(start_page.into()),
    )
    .title("Clash Verge")
    // Using WindowManager::prefer_system_titlebar to control if show system built-in titlebar
    // .decorations(true)
    .fullscreen(false)
    .inner_size(window_width, window_height)
    .min_inner_size(MINIMAL_WIDTH, MINIMAL_HEIGHT)
    .visible(false) // 等待主题色准备好后再展示，避免启动色差
    .initialization_script(&initial_script);
    
    // 只在需要时才居中（首次启动或监视器配置变化导致保存的位置无效）
    if should_center {
        builder = builder.center();
    }

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    builder = builder.background_color(background_color);

    match builder.build() {
        Ok(window) => {
            logging_error!(
                Type::Window,
                window.set_background_color(Some(background_color))
            );
            logging_error!(Type::Window, window.eval(INITIAL_LOADING_OVERLAY));
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

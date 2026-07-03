use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::utils::config::Color;
use tauri::webview::PageLoadEvent;
use tauri::{Theme, WebviewWindow};

use crate::{config::Config, core::handle, utils::resolve::window_script::build_window_initial_script};
use clash_verge_logging::{Type, logging_error};
// logging 仅在 macOS 的渲染进程恢复逻辑中使用
#[cfg(target_os = "macos")]
use clash_verge_logging::logging;

const DARK_BACKGROUND_COLOR: Color = Color(46, 48, 61, 255); // #2E303D
const LIGHT_BACKGROUND_COLOR: Color = Color(245, 245, 245, 255); // #F5F5F5
const DARK_BACKGROUND_HEX: &str = "#2E303D";
const LIGHT_BACKGROUND_HEX: &str = "#F5F5F5";

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 700.0;

const MINIMAL_WIDTH: f64 = 520.0;
const MINIMAL_HEIGHT: f64 = 520.0;

#[cfg(target_os = "linux")]
const DEFAULT_DECORATIONS: bool = false;
#[cfg(not(target_os = "linux"))]
const DEFAULT_DECORATIONS: bool = true;

const fn restored_window_size_is_too_small(width: u32, height: u32) -> bool {
    width < MINIMAL_WIDTH as u32 || height < MINIMAL_HEIGHT as u32
}

fn restore_default_size_if_needed(window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else {
        return;
    };

    if !restored_window_size_is_too_small(size.width, size.height) {
        return;
    }

    logging_error!(
        Type::Window,
        window.set_size(tauri::LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT))
    );
    logging_error!(Type::Window, window.center());
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

    let initial_script = build_window_initial_script(initial_theme_mode, DARK_BACKGROUND_HEX, LIGHT_BACKGROUND_HEX);

    let mut builder = tauri::WebviewWindowBuilder::new(
        app_handle,
        "main", /* the unique window label */
        tauri::WebviewUrl::App(start_page.into()),
    )
    .title("Clash Verge")
    .center()
    .decorations(DEFAULT_DECORATIONS)
    .fullscreen(false)
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MINIMAL_WIDTH, MINIMAL_HEIGHT)
    .visible(false) // 等待主题色准备好后再展示，避免启动色差
    .initialization_script(&initial_script)
    .general_autofill_enabled(false) // 禁用自动填充
    .on_page_load(move |window, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }

        logging_error!(Type::Window, window.show());
        logging_error!(Type::Window, window.set_focus());
    });

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    builder = builder.background_color(background_color);

    match builder.build() {
        Ok(window) => {
            logging_error!(Type::Window, window.set_background_color(Some(background_color)));
            restore_default_size_if_needed(&window);
            // 全新窗口的页面即为最新状态，丢弃旧窗口遗留的待重载标记，避免多余 reload
            #[cfg(target_os = "macos")]
            take_webview_needs_reload();
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 渲染进程死亡、页面待重载标记（macOS）
///
/// 渲染进程在窗口不可见时被系统终止后置位，由下次激活窗口的路径取走并执行 reload。
#[cfg(target_os = "macos")]
static WEBVIEW_NEEDS_RELOAD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 取出并清除"页面待重载"标记
///
/// # Returns
/// * `bool` - 渲染进程是否曾在窗口不可见时被系统终止、页面需要 reload
#[cfg(target_os = "macos")]
pub fn take_webview_needs_reload() -> bool {
    WEBVIEW_NEEDS_RELOAD.swap(false, std::sync::atomic::Ordering::SeqCst)
}

/// WebView 渲染进程被系统终止后的恢复处理（macOS）
///
/// macOS 在内存压力下可能杀掉 WKWebView 的 WebContent 渲染进程：
/// 1. 页面内容层消失，窗口打开后表现为白屏；
/// 2. 前端 JS 状态随之丢失，无法调用 `ws_disconnect` 清理 Mihomo WebSocket 订阅，
///    孤儿订阅持续把大于 1KB 的 payload（如 `/connections` 全量快照）塞进 tauri 的
///    `ChannelDataIpcQueue`，且没有存活的页面来取走，导致主进程内存无限增长。
///
/// 恢复策略：
/// * 窗口可见（前台被杀的罕见场景）——立即 reload 恢复页面；
/// * 窗口隐藏/最小化（托盘常驻的常见场景）——只置位待重载标记，等用户下次打开
///   窗口时再 reload。系统正是因内存压力才杀掉不可见窗口的渲染进程，此时立即
///   重建渲染进程既浪费内存，也可能形成"系统杀→拉起→再杀"的循环。
///
/// 注意：应用层注册 `on_web_content_process_terminate` 后会覆盖 tauri-runtime-wry
/// 的默认自动 reload 行为，因此页面死亡状态会一直保持到我们主动 reload。
///
/// # Arguments
/// * `webview` - 渲染进程被终止的 WebView
#[cfg(target_os = "macos")]
pub fn on_web_content_process_terminated(webview: &tauri::Webview) {
    if handle::Handle::global().is_exiting() {
        return;
    }

    logging!(
        warn,
        Type::Window,
        "WebView 渲染进程已被系统终止（label={}），开始恢复",
        webview.label()
    );

    // 关键步骤：清理 Rust 侧所有 Mihomo WebSocket 订阅。
    // 旧页面遗留的孤儿订阅（traffic/memory/connections/logs）自此停止向已死亡的
    // IPC Channel 推送数据，阻断 ChannelDataIpcQueue 泄漏；
    // 托盘速率任务的订阅也会被一并关闭，但其内部循环会在约 1 秒后自动重连。
    crate::process::AsyncHandler::spawn(|| async move {
        if let Err(err) = handle::Handle::mihomo().await.clear_all_ws_connections().await {
            logging!(warn, Type::Window, "清理 Mihomo WebSocket 连接失败: {err}");
        } else {
            logging!(info, Type::Window, "已清理全部 Mihomo WebSocket 连接");
        }
    });

    // is_user_visible：窗口是否处于用户可感知的可见状态（未隐藏且未最小化）
    let window = webview.window();
    let is_user_visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);

    if is_user_visible {
        // 关键步骤：窗口正被用户看着，立即 reload。加载请求会让 WKWebView
        // 自动重新拉起渲染进程，恢复页面内容（解决白屏）。
        logging_error!(Type::Window, webview.reload());
    } else {
        // 关键步骤：窗口不可见，延迟到下次激活窗口时再 reload（见
        // WindowManager::activate_window），避免在内存压力下重建无人观看的页面。
        WEBVIEW_NEEDS_RELOAD.store(true, std::sync::atomic::Ordering::SeqCst);
        logging!(info, Type::Window, "窗口不可见，页面将在下次打开窗口时重载");
    }
}

#[cfg(test)]
mod tests {
    use super::restored_window_size_is_too_small;

    #[test]
    fn restored_window_size_rejects_zero_dimensions() {
        assert!(restored_window_size_is_too_small(0, 700));
        assert!(restored_window_size_is_too_small(940, 0));
    }

    #[test]
    fn restored_window_size_rejects_dimensions_below_minimum() {
        assert!(restored_window_size_is_too_small(519, 700));
        assert!(restored_window_size_is_too_small(940, 519));
    }

    #[test]
    fn restored_window_size_accepts_minimum_or_larger_dimensions() {
        assert!(!restored_window_size_is_too_small(520, 520));
        assert!(!restored_window_size_is_too_small(940, 700));
    }
}

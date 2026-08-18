use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::utils::config::Color;
use tauri::webview::PageLoadEvent;
use tauri::{Theme, WebviewWindow};

use crate::{config::Config, core::handle, utils::resolve::window_script::build_window_initial_script};
use clash_verge_logging::logging;
use clash_verge_logging::{Type, logging_error};

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
            take_webview_needs_reload();
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 渲染进程死亡、页面待重载标记
///
/// 渲染进程在窗口不可见时被终止后置位，由下次激活窗口的路径取走并执行 reload。
///
/// 注：本标记与下方的恢复逻辑原本仅在 macOS 编译。Windows 上 WebView2 的渲染进程
/// 同样会在内存压力下被系统终止，且症状完全一致（白屏 + 孤儿 WS 订阅持续向
/// `ChannelDataIpcQueue` 写入导致主进程内存无限增长），故解除平台限制。
static WEBVIEW_NEEDS_RELOAD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 取出并清除"页面待重载"标记
///
/// # Returns
/// * `bool` - 渲染进程是否曾在窗口不可见时被终止、页面需要 reload
pub fn take_webview_needs_reload() -> bool {
    WEBVIEW_NEEDS_RELOAD.swap(false, std::sync::atomic::Ordering::SeqCst)
}

/// 重新置位"页面待重载"标记
///
/// 取走标记之后 reload 失败时必须调用，否则待重载状态就此丢失、后续激活不再重试。
///
/// 实测（Windows）：渲染进程在窗口不可见时死亡后，`reload()` 会返回
/// `runtime error: failed to send message to the webview`（`show()` / `set_focus()`
/// 同样失败）。此时若不还原标记，页面会永久停在空白状态直到应用重启。
pub fn mark_webview_needs_reload() {
    WEBVIEW_NEEDS_RELOAD.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// 渲染进程死亡后的公共恢复动作：清理孤儿 WS 订阅，必要时置位待重载标记。
///
/// 拆出来是因为触发源分平台：macOS 由 wry 的 `on_web_content_process_terminate`
/// 回调触发；Windows 无该回调（wry 中它属于 `WebViewBuilderExtDarwin`），改由
/// `start_renderer_liveness_watchdog` 的存活探测触发。**恢复动作本身平台无关。**
///
/// # Arguments
/// * `reload_now` - 窗口当前是否可见。可见则立即 reload 恢复页面；不可见则只置标记，
///   等用户下次打开窗口时再 reload（系统正是因内存压力才杀掉不可见窗口的渲染进程，
///   立即重建既浪费内存也可能形成"系统杀→拉起→再杀"的循环）
/// * `reload` - reload 用的回调，在 WS 清理完成之后执行
fn recover_from_render_process_death<F>(reload_now: bool, reload: F)
where
    F: FnOnce() + Send + 'static,
{
    if !reload_now {
        WEBVIEW_NEEDS_RELOAD.store(true, std::sync::atomic::Ordering::SeqCst);
        logging!(info, Type::Window, "窗口不可见，页面将在下次打开窗口时重载");
    }

    // 清理全部 Mihomo WS 订阅，阻断 ChannelDataIpcQueue 泄漏（托盘速率任务约 1s 后自重连）。
    // reload 必须与清理同任务、排在其后，否则清理可能误清重载后新页面的订阅（竞态）。
    crate::process::AsyncHandler::spawn(move || async move {
        if let Err(err) = handle::Handle::mihomo().await.clear_all_ws_connections().await {
            logging!(warn, Type::Window, "清理 Mihomo WebSocket 连接失败: {err}");
        } else {
            logging!(info, Type::Window, "已清理全部 Mihomo WebSocket 连接");
        }
        if reload_now {
            reload();
        }
    });
}

/// Windows：渲染进程存活探测（wry 在 Windows 上没有 `on_web_content_process_terminate`）
///
/// wry 的 `with_on_web_content_process_terminate_handler` 定义在
/// `#[cfg(any(target_os = "macos", target_os = "ios"))] pub trait WebViewBuilderExtDarwin`，
/// `WebViewBuilderExtWindows` 中没有等价项，因此 Windows 无法注册该回调。
///
/// 判据：本进程名下是否还存在 `--type=renderer` 的 WebView2 子进程。
///
/// 渲染进程被终止后，`msedgewebview2.exe` 的 browser / gpu-process / utility /
/// crashpad-handler 兄弟进程都还在，唯独少了 renderer，且 **WebView2 不会重建它**。
///
/// 为什么不用 IPC 探测：曾尝试以 `window.eval("void 0")` 是否成功作为判据，
/// 依据是渲染进程死亡后 `show()` / `set_focus()` 会返回
/// `runtime error: failed to send message to the webview`。实测该推断不成立——
/// 渲染进程已死时窗口操作仍可能成功（日志中出现过 `窗口激活成功`），
/// `eval` 同样不失败，探测永远不会触发。
///
/// 为什么不用 WebView2 的 `ICoreWebView2::add_ProcessFailed`：那是语义最准确的方案，
/// 但需要引入 `webview2-com` 直接依赖并与 wry 的版本保持一致；本判据无新增依赖，
/// 且实测可靠。若 wry 日后在 `WebViewBuilderExtWindows` 补上等价回调，应改用回调。
#[cfg(windows)]
fn renderer_process_count() -> Option<usize> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );

    let self_pid = sysinfo::Pid::from_u32(std::process::id());
    let mut renderers = 0usize;
    let mut any_webview_child = false;
    // 是否至少读到过一个非空命令行。若一个都读不到（权限/平台差异），
    // renderers 会恒为 0 而看起来像"渲染进程死了"——那是仪器问题，不是故障事实。
    let mut any_cmd_readable = false;

    for proc_ in sys.processes().values() {
        if !proc_
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("msedgewebview2.exe")
        {
            continue;
        }
        // 沿父链确认属于本进程（WebView2 子进程可能挂在 browser 进程下，非直接子进程）
        let mut cur = proc_.parent();
        let mut is_ours = false;
        for _ in 0..12 {
            let Some(p) = cur else { break };
            if p == self_pid {
                is_ours = true;
                break;
            }
            cur = sys.process(p).and_then(|x| x.parent());
        }
        if !is_ours {
            continue;
        }
        any_webview_child = true;
        let cmd = proc_.cmd();
        if !cmd.is_empty() {
            any_cmd_readable = true;
        }
        if cmd.iter().any(|a| a.to_string_lossy().contains("--type=renderer")) {
            renderers += 1;
        }
    }

    // ⛔「没量到」不能当成「渲染进程死了」——两种都返回 None 让上层不动作：
    //   1. 一个 WebView2 子进程都找不到：更像是没枚举到（真实的渲染进程死亡会留下
    //      browser / gpu-process / utility / crashpad-handler 兄弟进程）
    //   2. 找到了子进程却一个命令行都读不到：判据依赖命令行里的 --type=renderer，
    //      读不到时 renderers 恒为 0，会伪装成"渲染进程已死"并每轮误触发恢复。
    //      这比不触发更糟，故必须显式区分。
    if !any_webview_child || !any_cmd_readable {
        return None;
    }
    Some(renderers)
}

/// Windows：渲染进程存活探测（wry 在 Windows 上没有 `on_web_content_process_terminate`）
///
/// wry 的 `with_on_web_content_process_terminate_handler` 定义在
/// `#[cfg(any(target_os = "macos", target_os = "ios"))] pub trait WebViewBuilderExtDarwin`，
/// `WebViewBuilderExtWindows` 中没有等价项，因此 Windows 无法注册该回调。
/// 改由周期性检查渲染进程是否存在来触发同一套恢复逻辑，判据见 `renderer_process_count`。
///
/// 连续两次判定为 0 才动作，避开窗口重建等瞬时状态。
#[cfg(windows)]
pub fn start_renderer_liveness_watchdog() {
    use std::time::Duration;

    const PROBE_INTERVAL: Duration = Duration::from_secs(10);
    /// 连续多少次测到 0 才判定渲染进程已死。1 次会在窗口重建的瞬间误判。
    const REQUIRED_CONSECUTIVE_FAILURES: u32 = 2;

    crate::process::AsyncHandler::spawn(|| async move {
        let mut consecutive_failures: u32 = 0;
        // 已恢复过、且此后一直没再见到活的渲染进程。
        // 窗口不可见时渲染进程不会被拉起（这正是上游的设计：等用户下次打开再 reload），
        // 若不上闩，本循环会每 20s 重复清一次 WS，把托盘速率订阅也一并反复掐断。
        let mut recovered_awaiting_renderer = false;
        loop {
            tokio::time::sleep(PROBE_INTERVAL).await;
            if handle::Handle::global().is_exiting() {
                break;
            }
            let Some(window) = crate::utils::window_manager::WindowManager::get_main_window() else {
                consecutive_failures = 0;
                continue;
            };
            // None = 没枚举到，不是故障事实，不推进计数
            match renderer_process_count() {
                None => continue,
                Some(n) if n >= 1 => {
                    consecutive_failures = 0;
                    recovered_awaiting_renderer = false; // 渲染进程回来了，重新布防
                    continue;
                }
                Some(_) => {}
            }
            if recovered_awaiting_renderer {
                continue;
            }
            consecutive_failures += 1;
            if consecutive_failures < REQUIRED_CONSECUTIVE_FAILURES {
                continue;
            }
            consecutive_failures = 0;
            recovered_awaiting_renderer = true;

            logging!(
                warn,
                Type::Window,
                "WebView 渲染进程已终止（连续两次未检测到 renderer 子进程），开始恢复"
            );
            let is_user_visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            let reload_target = window.clone();
            recover_from_render_process_death(is_user_visible, move || {
                logging_error!(Type::Window, reload_target.reload());
            });
        }
    });
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

    let window = webview.window();
    let is_user_visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);

    // 懒重载标记仅供主窗口；其它 webview（update-splash）无消费通道，不可见时直接 reload 兜底
    let is_main_window = webview.label() == "main";
    let reload_now = is_user_visible || !is_main_window;

    let webview = webview.clone();
    recover_from_render_process_death(reload_now, move || {
        logging_error!(Type::Window, webview.reload());
    });
}

/// 消费待重载标记并 reload 主窗口。
/// 兜底原生取消最小化（Dock 缩略图/调度中心/窗口菜单）只触发 Focused(true)、不走
/// activate_window 的情况。与 activate_window 共用 swap 标记，先取先得、不重复 reload。
pub fn reload_main_window_if_needed() {
    if !take_webview_needs_reload() {
        return;
    }
    let Some(window) = crate::utils::window_manager::WindowManager::get_main_window() else {
        // 拿不到窗口不是"已重载"，标记要还回去
        mark_webview_needs_reload();
        return;
    };
    logging!(info, Type::Window, "渲染进程曾被系统终止，窗口聚焦后重载页面");
    if let Err(e) = window.reload() {
        logging!(warn, Type::Window, "重载页面失败，保留待重载标记以便下次重试: {e}");
        mark_webview_needs_reload();
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

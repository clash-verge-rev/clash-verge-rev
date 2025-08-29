use std::time::{Duration, Instant};

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use tauri::{Manager, WebviewWindow};

use crate::{
    core::handle,
    logging,
    module::lightweight,
    process::AsyncHandler,
    utils::{
        logging::Type,
        resolve::{
            ui::{get_ui_ready, update_ui_ready_stage, wait_for_ui_ready, UiReadyStage},
            window_script::{INITIAL_LOADING_OVERLAY, WINDOW_INITIAL_SCRIPT},
        },
    },
};

// 定义默认窗口尺寸常量
const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 700.0;

const MINIMAL_WIDTH: f64 = 520.0;
const MINIMAL_HEIGHT: f64 = 520.0;

// 窗口创建锁，防止并发创建窗口
static WINDOW_CREATING: OnceCell<Mutex<(bool, Instant)>> = OnceCell::new();

fn get_window_creating_lock() -> &'static Mutex<(bool, Instant)> {
    WINDOW_CREATING.get_or_init(|| Mutex::new((false, Instant::now())))
}

/// 检查是否已存在窗口，如果存在则显示并返回 true
fn check_existing_window(is_show: bool) -> Option<bool> {
    if let Some(app_handle) = handle::Handle::global().app_handle() {
        if let Some(window) = app_handle.get_webview_window("main") {
            logging!(info, Type::Window, true, "主窗口已存在，将显示现有窗口");
            if is_show {
                if window.is_minimized().unwrap_or(false) {
                    logging!(info, Type::Window, true, "窗口已最小化，正在取消最小化");
                    let _ = window.unminimize();
                }
                let _ = window.show();
                let _ = window.set_focus();

                #[cfg(target_os = "macos")]
                handle::Handle::global().set_activation_policy_regular();
            }
            return Some(true);
        }
    }
    None
}

/// 获取窗口创建锁，防止并发创建
fn acquire_window_creation_lock() -> Result<(), bool> {
    let creating_lock = get_window_creating_lock();
    let mut creating = creating_lock.lock();

    let (is_creating, last_time) = *creating;
    let elapsed = last_time.elapsed();

    if is_creating && elapsed < Duration::from_secs(2) {
        logging!(
            info,
            Type::Window,
            true,
            "窗口创建请求被忽略，因为最近创建过 ({:?}ms)",
            elapsed.as_millis()
        );
        return Err(false);
    }

    *creating = (true, Instant::now());
    Ok(())
}

/// 重置窗口创建锁
fn reset_window_creation_lock() {
    let creating_lock = get_window_creating_lock();
    let mut creating = creating_lock.lock();
    *creating = (false, Instant::now());
    logging!(debug, Type::Window, true, "窗口创建状态已重置");
}

/// 构建新的 WebView 窗口
fn build_new_window() -> Result<WebviewWindow, String> {
    let app_handle = handle::Handle::global().app_handle().ok_or_else(|| {
        logging!(
            error,
            Type::Window,
            true,
            "无法获取app_handle，窗口创建失败"
        );
        "无法获取app_handle".to_string()
    })?;

    tauri::WebviewWindowBuilder::new(
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
    .map_err(|e| {
        logging!(error, Type::Window, true, "主窗口构建失败: {}", e);
        e.to_string()
    })
}

/// 窗口创建后的初始设置
async fn setup_window_post_creation() {
    update_ui_ready_stage(UiReadyStage::NotStarted);
    handle::Handle::global().mark_startup_completed();

    logging!(
        debug,
        Type::Window,
        true,
        "异步窗口任务开始 (启动已标记完成)"
    );

    // 先运行轻量模式检测
    lightweight::run_once_auto_lightweight().await;

    // 发送启动完成事件，触发前端开始加载
    logging!(
        debug,
        Type::Window,
        true,
        "发送 verge://startup-completed 事件"
    );
    handle::Handle::notify_startup_completed();
}

/// 通过窗口标签处理窗口显示逻辑（减少任务大小的优化版本）
fn handle_window_display_by_label(window_label: String, is_show: bool) {
    if !is_show {
        logging!(
            debug,
            Type::Window,
            true,
            "is_show为false，窗口保持隐藏状态"
        );
        return;
    }

    // 通过标签重新获取窗口实例
    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            logging!(error, Type::Window, true, "无法获取app handle");
            return;
        }
    };

    let window = match app_handle.get_webview_window(&window_label) {
        Some(window) => window,
        None => {
            logging!(
                error,
                Type::Window,
                true,
                "无法通过标签获取窗口: {}",
                window_label
            );
            return;
        }
    };

    // 立即显示窗口
    let _ = window.show();
    let _ = window.set_focus();
    logging!(info, Type::Window, true, "窗口已立即显示");

    #[cfg(target_os = "macos")]
    handle::Handle::global().set_activation_policy_regular();

    let timeout_seconds = if crate::module::lightweight::is_in_lightweight_mode() {
        3
    } else {
        8
    };

    logging!(
        info,
        Type::Window,
        true,
        "开始监控UI加载状态 (最多{}秒)...",
        timeout_seconds
    );

    // 异步监控UI状态
    AsyncHandler::spawn(move || async move {
        monitor_ui_loading(timeout_seconds).await;
    });

    logging!(info, Type::Window, true, "窗口显示流程完成");
}

/// 监控 UI 加载状态 - 优雅的事件驱动版本
async fn monitor_ui_loading(timeout_seconds: u64) {
    logging!(
        debug,
        Type::Window,
        true,
        "启动UI状态监控，使用事件驱动方式，超时{}秒",
        timeout_seconds
    );

    // 使用事件驱动的方式等待 UI 就绪，完全消除轮询
    let ui_ready = wait_for_ui_ready(timeout_seconds).await;

    if ui_ready {
        logging!(info, Type::Window, true, "UI已完全加载就绪（事件驱动）");
        handle::Handle::global()
            .get_window()
            .map(|window| window.eval(INITIAL_LOADING_OVERLAY));
    } else {
        logging!(
            warn,
            Type::Window,
            true,
            "UI加载监控超时({}秒)，但窗口已正常显示",
            timeout_seconds
        );

        // 超时后手动设置 UI 就绪状态（保持向后兼容性）
        get_ui_ready().store(true, std::sync::atomic::Ordering::Release);
        logging!(info, Type::Window, true, "超时后成功设置UI就绪状态");
    }
}

pub async fn create_window(is_show: bool) -> bool {
    logging!(
        info,
        Type::Window,
        true,
        "开始创建/显示主窗口, is_show={}",
        is_show
    );

    if !is_show {
        lightweight::set_lightweight_mode(true).await;
        handle::Handle::notify_startup_completed();
        return false;
    }

    // 检查是否已存在窗口
    if let Some(result) = check_existing_window(is_show) {
        return result;
    }

    // 检查 app_handle 是否存在
    if handle::Handle::global().app_handle().is_none() {
        println!("fuck no window");
    }

    // 获取窗口创建锁
    if let Err(should_return) = acquire_window_creation_lock() {
        return should_return;
    }

    // 构建新窗口
    let newly_created_window = match build_new_window() {
        Ok(window) => {
            // 窗口创建成功，重置锁状态
            reset_window_creation_lock();
            window
        }
        Err(_) => {
            // 窗口创建失败，重置锁状态
            reset_window_creation_lock();
            return false;
        }
    };

    logging!(debug, Type::Window, true, "主窗口实例创建成功");

    // 获取窗口标签，减少闭包捕获的大小
    let window_label = newly_created_window.label().to_string();

    // 异步处理窗口后续设置，只捕获必要的小数据
    setup_window_post_creation().await;
    handle_window_display_by_label(window_label, is_show);

    true
}

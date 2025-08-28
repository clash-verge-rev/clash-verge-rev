use std::time::{Duration, Instant};

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use tauri::Manager;

use crate::{
    core::handle,
    logging,
    module::lightweight,
    process::AsyncHandler,
    utils::{
        logging::Type,
        resolve::{
            ui::{get_ui_ready, update_ui_ready_stage, UiReadyStage},
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
            return true;
        }
    }

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
        return false;
    }

    *creating = (true, Instant::now());

    // ScopeGuard 确保创建状态重置，防止 webview 卡死
    let _guard = scopeguard::guard(creating, |mut creating_guard| {
        *creating_guard = (false, Instant::now());
        logging!(debug, Type::Window, true, "[ScopeGuard] 窗口创建状态已重置");
    });

    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            logging!(
                error,
                Type::Window,
                true,
                "无法获取app_handle，窗口创建失败"
            );
            return false;
        }
    };

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
        Ok(newly_created_window) => {
            logging!(debug, Type::Window, true, "主窗口实例创建成功");

            update_ui_ready_stage(UiReadyStage::NotStarted);

            AsyncHandler::spawn(move || async move {
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

                if is_show {
                    let window_clone = newly_created_window.clone();

                    // 立即显示窗口
                    let _ = window_clone.show();
                    let _ = window_clone.set_focus();
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

                    // 异步监控UI状态，使用try_read避免死锁
                    AsyncHandler::spawn(move || async move {
                        logging!(
                            debug,
                            Type::Window,
                            true,
                            "启动UI状态监控线程，超时{}秒",
                            timeout_seconds
                        );

                        let ui_ready_checker = || async {
                            let (mut check_count, mut consecutive_failures) = (0, 0);

                            loop {
                                let is_ready = get_ui_ready()
                                    .try_read()
                                    .map(|guard| *guard)
                                    .unwrap_or_else(|| {
                                        consecutive_failures += 1;
                                        if consecutive_failures > 50 {
                                            logging!(
                                                warn,
                                                Type::Window,
                                                true,
                                                "UI状态监控连续{}次无法获取读锁，可能存在死锁",
                                                consecutive_failures
                                            );
                                            consecutive_failures = 0;
                                        }
                                        false
                                    });

                                if is_ready {
                                    logging!(
                                        debug,
                                        Type::Window,
                                        true,
                                        "UI状态监控检测到就绪信号，退出监控"
                                    );
                                    return;
                                }

                                consecutive_failures = 0;
                                tokio::time::sleep(Duration::from_millis(100)).await;
                                check_count += 1;

                                if check_count % 20 == 0 {
                                    logging!(
                                        debug,
                                        Type::Window,
                                        true,
                                        "UI加载状态检查... ({}秒)",
                                        check_count / 10
                                    );
                                }
                            }
                        };

                        let wait_result = tokio::time::timeout(
                            Duration::from_secs(timeout_seconds),
                            ui_ready_checker(),
                        )
                        .await;

                        match wait_result {
                            Ok(_) => {
                                logging!(info, Type::Window, true, "UI已完全加载就绪");
                                handle::Handle::global()
                                    .get_window()
                                    .map(|window| window.eval(INITIAL_LOADING_OVERLAY));
                            }
                            Err(_) => {
                                logging!(
                                    warn,
                                    Type::Window,
                                    true,
                                    "UI加载监控超时({}秒)，但窗口已正常显示",
                                    timeout_seconds
                                );

                                get_ui_ready()
                                    .try_write()
                                    .map(|mut guard| {
                                        *guard = true;
                                        logging!(
                                            info,
                                            Type::Window,
                                            true,
                                            "超时后成功设置UI就绪状态"
                                        );
                                    })
                                    .unwrap_or_else(|| {
                                        logging!(
                                            error,
                                            Type::Window,
                                            true,
                                            "超时后无法获取UI状态写锁，可能存在严重死锁"
                                        );
                                    });
                            }
                        }
                    });

                    logging!(info, Type::Window, true, "窗口显示流程完成");
                } else {
                    logging!(
                        debug,
                        Type::Window,
                        true,
                        "is_show为false，窗口保持隐藏状态"
                    );
                }
            });
            true
        }
        Err(e) => {
            logging!(error, Type::Window, true, "主窗口构建失败: {}", e);
            false
        }
    }
}

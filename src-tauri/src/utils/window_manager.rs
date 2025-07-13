use crate::{core::handle, logging, utils::logging::Type};
use tauri::{Manager, WebviewWindow, Wry};

#[cfg(target_os = "macos")]
use crate::AppHandleManager;

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use scopeguard;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

/// 窗口操作结果
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowOperationResult {
    /// 窗口已显示并获得焦点
    Shown,
    /// 窗口已隐藏
    Hidden,
    /// 创建了新窗口
    Created,
    /// 操作失败
    Failed,
    /// 无需操作
    NoAction,
}

/// 窗口状态
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowState {
    /// 窗口可见且有焦点
    VisibleFocused,
    /// 窗口可见但无焦点
    VisibleUnfocused,
    /// 窗口最小化
    Minimized,
    /// 窗口隐藏
    Hidden,
    /// 窗口不存在
    NotExist,
}

// 窗口操作防抖机制
static WINDOW_OPERATION_DEBOUNCE: OnceCell<Mutex<Instant>> = OnceCell::new();
static WINDOW_OPERATION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
const WINDOW_OPERATION_DEBOUNCE_MS: u64 = 500;

fn get_window_operation_debounce() -> &'static Mutex<Instant> {
    WINDOW_OPERATION_DEBOUNCE.get_or_init(|| Mutex::new(Instant::now() - Duration::from_secs(1)))
}

fn should_handle_window_operation() -> bool {
    if WINDOW_OPERATION_IN_PROGRESS.load(Ordering::Acquire) {
        log::warn!(target: "app", "[防抖] 窗口操作已在进行中，跳过重复调用");
        return false;
    }

    let debounce_lock = get_window_operation_debounce();
    let mut last_operation = debounce_lock.lock();
    let now = Instant::now();
    let elapsed = now.duration_since(*last_operation);

    log::debug!(target: "app", "[防抖] 检查窗口操作间隔: {}ms (需要>={}ms)", 
              elapsed.as_millis(), WINDOW_OPERATION_DEBOUNCE_MS);

    if elapsed >= Duration::from_millis(WINDOW_OPERATION_DEBOUNCE_MS) {
        *last_operation = now;
        WINDOW_OPERATION_IN_PROGRESS.store(true, Ordering::Release);
        log::info!(target: "app", "[防抖] 窗口操作被允许执行");
        true
    } else {
        log::warn!(target: "app", "[防抖] 窗口操作被防抖机制忽略，距离上次操作 {}ms < {}ms", 
                  elapsed.as_millis(), WINDOW_OPERATION_DEBOUNCE_MS);
        false
    }
}

fn finish_window_operation() {
    WINDOW_OPERATION_IN_PROGRESS.store(false, Ordering::Release);
}

/// 统一的窗口管理器
pub struct WindowManager;

impl WindowManager {
    pub fn get_main_window_state() -> WindowState {
        match Self::get_main_window() {
            Some(window) => {
                let is_minimized = window.is_minimized().unwrap_or(false);
                let is_visible = window.is_visible().unwrap_or(false);
                let is_focused = window.is_focused().unwrap_or(false);

                if is_minimized {
                    return WindowState::Minimized;
                }

                if !is_visible {
                    return WindowState::Hidden;
                }

                if is_focused {
                    WindowState::VisibleFocused
                } else {
                    WindowState::VisibleUnfocused
                }
            }
            None => WindowState::NotExist,
        }
    }

    /// 获取主窗口实例
    pub fn get_main_window() -> Option<WebviewWindow<Wry>> {
        handle::Handle::global()
            .app_handle()
            .and_then(|app| app.get_webview_window("main"))
    }

    /// 智能显示主窗口
    pub fn show_main_window() -> WindowOperationResult {
        // 防抖检查
        if !should_handle_window_operation() {
            return WindowOperationResult::NoAction;
        }
        let _guard = scopeguard::guard((), |_| {
            finish_window_operation();
        });

        logging!(info, Type::Window, true, "开始智能显示主窗口");
        logging!(
            debug,
            Type::Window,
            true,
            "{}",
            Self::get_window_status_info()
        );

        let current_state = Self::get_main_window_state();

        match current_state {
            WindowState::NotExist => {
                logging!(info, Type::Window, true, "窗口不存在，创建新窗口");
                if Self::create_new_window() {
                    logging!(info, Type::Window, true, "窗口创建成功");
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    WindowOperationResult::Created
                } else {
                    logging!(warn, Type::Window, true, "窗口创建失败");
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleFocused => {
                logging!(info, Type::Window, true, "窗口已经可见且有焦点，无需操作");
                WindowOperationResult::NoAction
            }
            WindowState::VisibleUnfocused | WindowState::Minimized | WindowState::Hidden => {
                if let Some(window) = Self::get_main_window() {
                    let state_after_check = Self::get_main_window_state();
                    if state_after_check == WindowState::VisibleFocused {
                        logging!(
                            info,
                            Type::Window,
                            true,
                            "窗口在检查期间已变为可见和有焦点状态"
                        );
                        return WindowOperationResult::NoAction;
                    }
                    Self::activate_window(&window)
                } else {
                    WindowOperationResult::Failed
                }
            }
        }
    }

    /// 切换主窗口显示状态（显示/隐藏）
    pub fn toggle_main_window() -> WindowOperationResult {
        // 防抖检查
        if !should_handle_window_operation() {
            return WindowOperationResult::NoAction;
        }
        let _guard = scopeguard::guard((), |_| {
            finish_window_operation();
        });

        logging!(info, Type::Window, true, "开始切换主窗口显示状态");

        let current_state = Self::get_main_window_state();
        logging!(
            info,
            Type::Window,
            true,
            "当前窗口状态: {:?} | 详细状态: {}",
            current_state,
            Self::get_window_status_info()
        );

        match current_state {
            WindowState::NotExist => {
                // 窗口不存在，创建新窗口
                logging!(info, Type::Window, true, "窗口不存在，将创建新窗口");
                // 由于已经有防抖保护，直接调用内部方法
                if Self::create_new_window() {
                    WindowOperationResult::Created
                } else {
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleFocused | WindowState::VisibleUnfocused => {
                logging!(
                    info,
                    Type::Window,
                    true,
                    "窗口可见（焦点状态: {}），将隐藏窗口",
                    if current_state == WindowState::VisibleFocused {
                        "有焦点"
                    } else {
                        "无焦点"
                    }
                );
                if let Some(window) = Self::get_main_window() {
                    match window.hide() {
                        Ok(_) => {
                            logging!(info, Type::Window, true, "窗口已成功隐藏");
                            WindowOperationResult::Hidden
                        }
                        Err(e) => {
                            logging!(warn, Type::Window, true, "隐藏窗口失败: {}", e);
                            WindowOperationResult::Failed
                        }
                    }
                } else {
                    logging!(warn, Type::Window, true, "无法获取窗口实例");
                    WindowOperationResult::Failed
                }
            }
            WindowState::Minimized | WindowState::Hidden => {
                logging!(
                    info,
                    Type::Window,
                    true,
                    "窗口存在但被隐藏或最小化，将激活窗口"
                );
                if let Some(window) = Self::get_main_window() {
                    Self::activate_window(&window)
                } else {
                    logging!(warn, Type::Window, true, "无法获取窗口实例");
                    WindowOperationResult::Failed
                }
            }
        }
    }

    /// 激活窗口（取消最小化、显示、设置焦点）
    fn activate_window(window: &WebviewWindow<Wry>) -> WindowOperationResult {
        logging!(info, Type::Window, true, "开始激活窗口");

        let mut operations_successful = true;

        // 1. 如果窗口最小化，先取消最小化
        if window.is_minimized().unwrap_or(false) {
            logging!(info, Type::Window, true, "窗口已最小化，正在取消最小化");
            if let Err(e) = window.unminimize() {
                logging!(warn, Type::Window, true, "取消最小化失败: {}", e);
                operations_successful = false;
            }
        }

        // 2. 显示窗口
        if let Err(e) = window.show() {
            logging!(warn, Type::Window, true, "显示窗口失败: {}", e);
            operations_successful = false;
        }

        // 3. 设置焦点
        if let Err(e) = window.set_focus() {
            logging!(warn, Type::Window, true, "设置窗口焦点失败: {}", e);
            operations_successful = false;
        }

        // 4. 平台特定的激活策略
        #[cfg(target_os = "macos")]
        {
            logging!(info, Type::Window, true, "应用 macOS 特定的激活策略");
            AppHandleManager::global().set_activation_policy_regular();
        }

        #[cfg(target_os = "windows")]
        {
            // Windows 尝试额外的激活方法
            if let Err(e) = window.set_always_on_top(true) {
                logging!(
                    debug,
                    Type::Window,
                    true,
                    "设置置顶失败（非关键错误）: {}",
                    e
                );
            }
            // 立即取消置顶
            if let Err(e) = window.set_always_on_top(false) {
                logging!(
                    debug,
                    Type::Window,
                    true,
                    "取消置顶失败（非关键错误）: {}",
                    e
                );
            }
        }

        if operations_successful {
            logging!(info, Type::Window, true, "窗口激活成功");
            WindowOperationResult::Shown
        } else {
            logging!(warn, Type::Window, true, "窗口激活部分失败");
            WindowOperationResult::Failed
        }
    }

    /// 隐藏主窗口
    pub fn hide_main_window() -> WindowOperationResult {
        logging!(info, Type::Window, true, "开始隐藏主窗口");

        match Self::get_main_window() {
            Some(window) => match window.hide() {
                Ok(_) => {
                    logging!(info, Type::Window, true, "窗口已隐藏");
                    WindowOperationResult::Hidden
                }
                Err(e) => {
                    logging!(warn, Type::Window, true, "隐藏窗口失败: {}", e);
                    WindowOperationResult::Failed
                }
            },
            None => {
                logging!(info, Type::Window, true, "窗口不存在，无需隐藏");
                WindowOperationResult::NoAction
            }
        }
    }

    /// 检查窗口是否可见
    pub fn is_main_window_visible() -> bool {
        Self::get_main_window()
            .map(|window| window.is_visible().unwrap_or(false))
            .unwrap_or(false)
    }

    /// 检查窗口是否有焦点
    pub fn is_main_window_focused() -> bool {
        Self::get_main_window()
            .map(|window| window.is_focused().unwrap_or(false))
            .unwrap_or(false)
    }

    /// 检查窗口是否最小化
    pub fn is_main_window_minimized() -> bool {
        Self::get_main_window()
            .map(|window| window.is_minimized().unwrap_or(false))
            .unwrap_or(false)
    }

    /// 创建新窗口,防抖避免重复调用
    fn create_new_window() -> bool {
        use crate::utils::resolve;
        resolve::create_window(true)
    }

    /// 获取详细的窗口状态信息
    pub fn get_window_status_info() -> String {
        let state = Self::get_main_window_state();
        let is_visible = Self::is_main_window_visible();
        let is_focused = Self::is_main_window_focused();
        let is_minimized = Self::is_main_window_minimized();

        format!(
            "窗口状态: {state:?} | 可见: {is_visible} | 有焦点: {is_focused} | 最小化: {is_minimized}"
        )
    }
}

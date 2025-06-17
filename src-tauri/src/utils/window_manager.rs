use crate::{core::handle, logging, utils::logging::Type};
use tauri::{Manager, WebviewWindow, Wry};

#[cfg(target_os = "macos")]
use crate::AppHandleManager;

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

/// 统一的窗口管理器
pub struct WindowManager;

impl WindowManager {
    pub fn get_main_window_state() -> WindowState {
        if let Some(window) = Self::get_main_window() {
            if window.is_minimized().unwrap_or(false) {
                WindowState::Minimized
            } else if window.is_visible().unwrap_or(false) {
                if window.is_focused().unwrap_or(false) {
                    WindowState::VisibleFocused
                } else {
                    WindowState::VisibleUnfocused
                }
            } else {
                WindowState::Hidden
            }
        } else {
            WindowState::NotExist
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
                    WindowOperationResult::Created
                } else {
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleFocused => {
                logging!(info, Type::Window, true, "窗口已经可见且有焦点，无需操作");
                WindowOperationResult::NoAction
            }
            WindowState::VisibleUnfocused | WindowState::Minimized | WindowState::Hidden => {
                if let Some(window) = Self::get_main_window() {
                    Self::activate_window(&window)
                } else {
                    WindowOperationResult::Failed
                }
            }
        }
    }

    /// 切换主窗口显示状态（显示/隐藏）
    pub fn toggle_main_window() -> WindowOperationResult {
        logging!(info, Type::Window, true, "开始切换主窗口显示状态");

        let current_state = Self::get_main_window_state();
        logging!(
            info,
            Type::Window,
            true,
            "当前窗口状态: {:?}",
            current_state
        );

        match current_state {
            WindowState::NotExist => {
                // 窗口不存在，创建新窗口
                if Self::create_new_window() {
                    WindowOperationResult::Created
                } else {
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleFocused => {
                // 窗口可见且有焦点，隐藏它
                if let Some(window) = Self::get_main_window() {
                    if window.hide().is_ok() {
                        logging!(info, Type::Window, true, "窗口已隐藏");
                        WindowOperationResult::Hidden
                    } else {
                        WindowOperationResult::Failed
                    }
                } else {
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleUnfocused | WindowState::Minimized | WindowState::Hidden => {
                // 窗口存在但不可见或无焦点，激活它
                if let Some(window) = Self::get_main_window() {
                    Self::activate_window(&window)
                } else {
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

        if let Some(window) = Self::get_main_window() {
            if window.hide().is_ok() {
                logging!(info, Type::Window, true, "窗口已隐藏");
                WindowOperationResult::Hidden
            } else {
                logging!(warn, Type::Window, true, "隐藏窗口失败");
                WindowOperationResult::Failed
            }
        } else {
            logging!(info, Type::Window, true, "窗口不存在，无需隐藏");
            WindowOperationResult::NoAction
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

    /// 创建新窗口现有的实现
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
            "窗口状态: {:?} | 可见: {} | 有焦点: {} | 最小化: {}",
            state, is_visible, is_focused, is_minimized
        )
    }
}

use crate::{core::handle, utils::resolve::window::build_new_window};
use clash_verge_limiter::Limiter;
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use std::pin::Pin;
use std::time::Duration;
use tauri::{Manager as _, WebviewWindow, Wry};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowOperationResult {
    Shown,
    Hidden,
    Created,
    Destroyed,
    Failed,
    NoAction,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowState {
    VisibleFocused,
    VisibleUnfocused,
    Minimized,
    Hidden,
    NotExist,
}

const WINDOW_OPERATION_DEBOUNCE_MS: u64 = 625;
static WINDOW_OPERATION_LIMITER: Lazy<Limiter> = Lazy::new(|| {
    Limiter::new(
        Duration::from_millis(WINDOW_OPERATION_DEBOUNCE_MS),
        clash_verge_limiter::SystemClock,
    )
});

fn should_handle_window_operation() -> bool {
    let allow = WINDOW_OPERATION_LIMITER.check();
    if !allow {
        logging!(debug, Type::Window, "window operation rate limited");
    }
    allow
}

pub struct WindowManager;

impl WindowManager {
    #[cfg(target_os = "macos")]
    fn set_macos_activation_policy_regular() {
        logging!(info, Type::Window, "应用 macOS 特定的激活策略");
        handle::Handle::global().set_activation_policy_regular();
    }

    fn get_main_window_with_state() -> (Option<WebviewWindow<Wry>>, WindowState) {
        let Some(window) = Self::get_main_window() else {
            return (None, WindowState::NotExist);
        };

        let is_minimized = window.is_minimized().unwrap_or(false);
        let is_visible = window.is_visible().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);

        let state = if is_minimized {
            WindowState::Minimized
        } else if !is_visible {
            WindowState::Hidden
        } else if is_focused {
            WindowState::VisibleFocused
        } else {
            WindowState::VisibleUnfocused
        };

        (Some(window), state)
    }

    pub fn get_main_window_state() -> WindowState {
        Self::get_main_window_with_state().1
    }

    pub fn get_main_window() -> Option<WebviewWindow<Wry>> {
        let app_handle = handle::Handle::app_handle();
        app_handle.get_webview_window("main")
    }

    pub async fn show_main_window() -> WindowOperationResult {
        if !should_handle_window_operation() {
            return WindowOperationResult::NoAction;
        }

        logging!(info, Type::Window, "开始智能显示主窗口");
        logging!(debug, Type::Window, "{}", Self::get_window_status_info());

        let current_state = Self::get_main_window_state();

        match current_state {
            WindowState::NotExist => {
                logging!(info, Type::Window, "窗口不存在，创建新窗口");
                if Self::create_window(true).await {
                    logging!(info, Type::Window, "窗口创建成功");
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    WindowOperationResult::Created
                } else {
                    logging!(warn, Type::Window, "窗口创建失败");
                    WindowOperationResult::Failed
                }
            }
            WindowState::VisibleFocused => {
                logging!(info, Type::Window, "窗口已经可见且有焦点，无需操作");
                WindowOperationResult::NoAction
            }
            WindowState::VisibleUnfocused | WindowState::Minimized | WindowState::Hidden => {
                let (window, state_after_check) = Self::get_main_window_with_state();
                if state_after_check == WindowState::VisibleFocused {
                    logging!(info, Type::Window, "窗口在检查期间已变为可见和有焦点状态");
                    return WindowOperationResult::NoAction;
                }
                if let Some(window) = window {
                    Self::activate_window(&window)
                } else {
                    WindowOperationResult::Failed
                }
            }
        }
    }

    pub async fn toggle_main_window() -> WindowOperationResult {
        if !should_handle_window_operation() {
            return WindowOperationResult::NoAction;
        }

        let (window, state) = Self::get_main_window_with_state();

        logging!(debug, Type::Window, "当前状态: {:?}", state);

        match state {
            WindowState::NotExist => Self::handle_not_exist_toggle().await,
            WindowState::VisibleFocused | WindowState::VisibleUnfocused => Self::hide_main_window(window.as_ref()),
            WindowState::Minimized | WindowState::Hidden => Self::activate_existing_main_window(window.as_ref()),
        }
    }

    async fn handle_not_exist_toggle() -> WindowOperationResult {
        logging!(info, Type::Window, "窗口不存在，将创建新窗口");
        if Self::create_window(true).await {
            WindowOperationResult::Created
        } else {
            WindowOperationResult::Failed
        }
    }

    fn hide_main_window(window: Option<&WebviewWindow<Wry>>) -> WindowOperationResult {
        logging!(info, Type::Window, "窗口可见，将隐藏窗口");
        if let Some(window) = window {
            match window.close() {
                Ok(_) => {
                    logging!(info, Type::Window, "窗口已成功隐藏");
                    WindowOperationResult::Hidden
                }
                Err(e) => {
                    logging!(warn, Type::Window, "隐藏窗口失败: {}", e);
                    WindowOperationResult::Failed
                }
            }
        } else {
            logging!(warn, Type::Window, "无法获取窗口实例");
            WindowOperationResult::Failed
        }
    }

    fn activate_existing_main_window(window: Option<&WebviewWindow<Wry>>) -> WindowOperationResult {
        logging!(info, Type::Window, "窗口存在但被隐藏或最小化，将激活窗口");
        if let Some(window) = window {
            Self::activate_window(window)
        } else {
            logging!(warn, Type::Window, "无法获取窗口实例");
            WindowOperationResult::Failed
        }
    }

    fn activate_window(window: &WebviewWindow<Wry>) -> WindowOperationResult {
        logging!(info, Type::Window, "开始激活窗口");
        #[cfg(target_os = "macos")]
        Self::set_macos_activation_policy_regular();

        // After renderer termination, defer show/focus until reload finishes to avoid a white flash.
        #[allow(unused_mut)]
        let mut defer_show_to_page_load = false;
        #[cfg(target_os = "macos")]
        if crate::utils::resolve::window::take_webview_needs_reload() {
            logging!(info, Type::Window, "渲染进程曾被系统终止，激活窗口前重载页面");
            match window.reload() {
                Ok(()) => defer_show_to_page_load = true,
                Err(e) => logging!(warn, Type::Window, "重载页面失败，退回直接显示: {}", e),
            }
        }

        let mut operations_successful = true;

        if window.is_minimized().unwrap_or(false) {
            logging!(info, Type::Window, "窗口已最小化，正在取消最小化");
            if let Err(e) = window.unminimize() {
                logging!(warn, Type::Window, "取消最小化失败: {}", e);
                operations_successful = false;
            }
        }

        if !defer_show_to_page_load {
            if let Err(e) = window.show() {
                logging!(warn, Type::Window, "显示窗口失败: {}", e);
                operations_successful = false;
            }
            if let Err(e) = window.set_focus() {
                logging!(warn, Type::Window, "设置窗口焦点失败: {}", e);
                operations_successful = false;
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Err(e) = window.set_always_on_top(true) {
                logging!(debug, Type::Window, "设置置顶失败（非关键错误）: {}", e);
            }
            if let Err(e) = window.set_always_on_top(false) {
                logging!(debug, Type::Window, "取消置顶失败（非关键错误）: {}", e);
            }
        }

        if operations_successful {
            logging!(info, Type::Window, "窗口激活成功");
            WindowOperationResult::Shown
        } else {
            logging!(warn, Type::Window, "窗口激活部分失败");
            WindowOperationResult::Failed
        }
    }

    pub fn is_main_window_visible(window: Option<&WebviewWindow<Wry>>) -> bool {
        window.map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false)
    }

    pub fn is_main_window_focused(window: Option<&WebviewWindow<Wry>>) -> bool {
        window.map(|w| w.is_focused().unwrap_or(false)).unwrap_or(false)
    }

    fn is_main_window_minimized(window: Option<&WebviewWindow<Wry>>) -> bool {
        window.map(|w| w.is_minimized().unwrap_or(false)).unwrap_or(false)
    }

    /// Keep new windows hidden until the frontend overlay renders, avoiding a theme flash.
    pub fn create_window(should_create: bool) -> Pin<Box<dyn Future<Output = bool> + Send>> {
        Box::pin(async move {
            logging!(info, Type::Window, "开始创建主窗口, should_create={}", should_create);

            if !should_create {
                return false;
            }

            #[cfg(target_os = "macos")]
            Self::set_macos_activation_policy_regular();

            match build_new_window().await {
                Ok(_) => {
                    logging!(info, Type::Window, "新窗口创建成功，等待前端渲染后显示");

                    true
                }
                Err(e) => {
                    logging!(error, Type::Window, "新窗口创建失败: {}", e);
                    false
                }
            }
        })
    }

    pub fn destroy_main_window() -> WindowOperationResult {
        if let Some(window) = Self::get_main_window() {
            let _ = window.destroy();
            logging!(info, Type::Window, "窗口已摧毁");
            #[cfg(target_os = "macos")]
            {
                logging!(info, Type::Window, "应用 macOS 特定的激活策略");
                handle::Handle::global().set_activation_policy_accessory();
            }
            return WindowOperationResult::Destroyed;
        }
        WindowOperationResult::Failed
    }

    fn get_window_status_info() -> String {
        let (window, state) = Self::get_main_window_with_state();
        let is_visible = Self::is_main_window_visible(window.as_ref());
        let is_focused = Self::is_main_window_focused(window.as_ref());
        let is_minimized = Self::is_main_window_minimized(window.as_ref());

        format!("窗口状态: {state:?} | 可见: {is_visible} | 有焦点: {is_focused} | 最小化: {is_minimized}")
    }
}

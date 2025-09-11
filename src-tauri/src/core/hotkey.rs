use crate::process::AsyncHandler;
use crate::utils::notification::{NotificationEvent, notify_event};
use crate::{
    config::Config, core::handle, feat, logging, logging_error,
    module::lightweight::entry_lightweight_mode, singleton_with_logging, utils::logging::Type,
};
use anyhow::{Result, bail};
use parking_lot::Mutex;
use std::{collections::HashMap, fmt, str::FromStr, sync::Arc};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};

/// Enum representing all available hotkey functions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HotkeyFunction {
    OpenOrCloseDashboard,
    ClashModeRule,
    ClashModeGlobal,
    ClashModeDirect,
    ToggleSystemProxy,
    ToggleTunMode,
    EntryLightweightMode,
    Quit,
    #[cfg(target_os = "macos")]
    Hide,
}

impl fmt::Display for HotkeyFunction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            HotkeyFunction::OpenOrCloseDashboard => "open_or_close_dashboard",
            HotkeyFunction::ClashModeRule => "clash_mode_rule",
            HotkeyFunction::ClashModeGlobal => "clash_mode_global",
            HotkeyFunction::ClashModeDirect => "clash_mode_direct",
            HotkeyFunction::ToggleSystemProxy => "toggle_system_proxy",
            HotkeyFunction::ToggleTunMode => "toggle_tun_mode",
            HotkeyFunction::EntryLightweightMode => "entry_lightweight_mode",
            HotkeyFunction::Quit => "quit",
            #[cfg(target_os = "macos")]
            HotkeyFunction::Hide => "hide",
        };
        write!(f, "{s}")
    }
}

impl FromStr for HotkeyFunction {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "open_or_close_dashboard" => Ok(HotkeyFunction::OpenOrCloseDashboard),
            "clash_mode_rule" => Ok(HotkeyFunction::ClashModeRule),
            "clash_mode_global" => Ok(HotkeyFunction::ClashModeGlobal),
            "clash_mode_direct" => Ok(HotkeyFunction::ClashModeDirect),
            "toggle_system_proxy" => Ok(HotkeyFunction::ToggleSystemProxy),
            "toggle_tun_mode" => Ok(HotkeyFunction::ToggleTunMode),
            "entry_lightweight_mode" => Ok(HotkeyFunction::EntryLightweightMode),
            "quit" => Ok(HotkeyFunction::Quit),
            #[cfg(target_os = "macos")]
            "hide" => Ok(HotkeyFunction::Hide),
            _ => bail!("invalid hotkey function: {}", s),
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
/// Enum representing predefined system hotkeys
pub enum SystemHotkey {
    CmdQ,
    CmdW,
}

#[cfg(target_os = "macos")]
impl fmt::Display for SystemHotkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            SystemHotkey::CmdQ => "CMD+Q",
            SystemHotkey::CmdW => "CMD+W",
        };
        write!(f, "{s}")
    }
}

#[cfg(target_os = "macos")]
impl SystemHotkey {
    pub fn function(self) -> HotkeyFunction {
        match self {
            SystemHotkey::CmdQ => HotkeyFunction::Quit,
            SystemHotkey::CmdW => HotkeyFunction::Hide,
        }
    }
}

pub struct Hotkey {
    current: Arc<Mutex<Vec<String>>>,
}

impl Hotkey {
    fn new() -> Self {
        Self {
            current: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Execute the function associated with a hotkey function enum
    fn execute_function(function: HotkeyFunction, app_handle: &AppHandle) {
        let app_handle = app_handle.clone();
        match function {
            HotkeyFunction::OpenOrCloseDashboard => {
                AsyncHandler::spawn(async move || {
                    crate::feat::open_or_close_dashboard().await;
                    notify_event(app_handle, NotificationEvent::DashboardToggled).await;
                });
            }
            HotkeyFunction::ClashModeRule => {
                AsyncHandler::spawn(async move || {
                    feat::change_clash_mode("rule".into()).await;
                    notify_event(
                        app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Rule" },
                    )
                    .await;
                });
            }
            HotkeyFunction::ClashModeGlobal => {
                AsyncHandler::spawn(async move || {
                    feat::change_clash_mode("global".into()).await;
                    notify_event(
                        app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Global" },
                    )
                    .await;
                });
            }
            HotkeyFunction::ClashModeDirect => {
                AsyncHandler::spawn(async move || {
                    feat::change_clash_mode("direct".into()).await;
                    notify_event(
                        app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Direct" },
                    )
                    .await;
                });
            }
            HotkeyFunction::ToggleSystemProxy => {
                AsyncHandler::spawn(async move || {
                    feat::toggle_system_proxy().await;
                    notify_event(app_handle, NotificationEvent::SystemProxyToggled).await;
                });
            }
            HotkeyFunction::ToggleTunMode => {
                AsyncHandler::spawn(async move || {
                    feat::toggle_tun_mode(None).await;
                    notify_event(app_handle, NotificationEvent::TunModeToggled).await;
                });
            }
            HotkeyFunction::EntryLightweightMode => {
                AsyncHandler::spawn(async move || {
                    entry_lightweight_mode().await;
                    notify_event(app_handle, NotificationEvent::LightweightModeEntered).await;
                });
            }
            HotkeyFunction::Quit => {
                AsyncHandler::spawn(async move || {
                    notify_event(app_handle, NotificationEvent::AppQuit).await;
                    feat::quit().await;
                });
            }
            #[cfg(target_os = "macos")]
            HotkeyFunction::Hide => {
                AsyncHandler::spawn(async move || {
                    feat::hide().await;
                    notify_event(app_handle, NotificationEvent::AppHidden).await;
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    /// Register a system hotkey using enum
    pub async fn register_system_hotkey(&self, hotkey: SystemHotkey) -> Result<()> {
        let hotkey_str = hotkey.to_string();
        let function = hotkey.function();
        self.register_hotkey_with_function(&hotkey_str, function)
            .await
    }

    #[cfg(target_os = "macos")]
    /// Unregister a system hotkey using enum
    pub fn unregister_system_hotkey(&self, hotkey: SystemHotkey) -> Result<()> {
        let hotkey_str = hotkey.to_string();
        self.unregister(&hotkey_str)
    }

    /// Register a hotkey with function enum
    #[allow(clippy::unused_async)]
    pub async fn register_hotkey_with_function(
        &self,
        hotkey: &str,
        function: HotkeyFunction,
    ) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for hotkey registration"))?;
        let manager = app_handle.global_shortcut();

        logging!(
            debug,
            Type::Hotkey,
            "Attempting to register hotkey: {} for function: {}",
            hotkey,
            function
        );

        if manager.is_registered(hotkey) {
            logging!(
                debug,
                Type::Hotkey,
                "Hotkey {} was already registered, unregistering first",
                hotkey
            );
            manager.unregister(hotkey)?;
        }

        let is_quit = matches!(function, HotkeyFunction::Quit);

        let _ = manager.on_shortcut(hotkey, move |app_handle, hotkey_event, event| {
            let hotkey_event_owned = *hotkey_event;
            let event_owned = event;
            let function_owned = function;
            let is_quit_owned = is_quit;

            let app_handle_cloned = app_handle.clone();

            AsyncHandler::spawn(move || async move {
                if event_owned.state == ShortcutState::Pressed {
                    logging!(
                        debug,
                        Type::Hotkey,
                        "Hotkey pressed: {:?}",
                        hotkey_event_owned
                    );

                    if hotkey_event_owned.key == Code::KeyQ && is_quit_owned {
                        if let Some(window) = app_handle_cloned.get_webview_window("main")
                            && window.is_focused().unwrap_or(false)
                        {
                            logging!(debug, Type::Hotkey, "Executing quit function");
                            Self::execute_function(function_owned, &app_handle_cloned);
                        }
                    } else {
                        logging!(debug, Type::Hotkey, "Executing function directly");

                        let is_enable_global_hotkey = Config::verge()
                            .await
                            .latest_ref()
                            .enable_global_hotkey
                            .unwrap_or(true);

                        if is_enable_global_hotkey {
                            Self::execute_function(function_owned, &app_handle_cloned);
                        } else {
                            use crate::utils::window_manager::WindowManager;
                            let is_visible = WindowManager::is_main_window_visible();
                            let is_focused = WindowManager::is_main_window_focused();

                            if is_focused && is_visible {
                                Self::execute_function(function_owned, &app_handle_cloned);
                            }
                        }
                    }
                }
            });
        });

        logging!(
            debug,
            Type::Hotkey,
            "Successfully registered hotkey {} for {}",
            hotkey,
            function
        );
        Ok(())
    }
}

// Use unified singleton macro
singleton_with_logging!(Hotkey, INSTANCE, "Hotkey");

impl Hotkey {
    pub async fn init(&self) -> Result<()> {
        let verge = Config::verge().await;
        let enable_global_hotkey = verge.latest_ref().enable_global_hotkey.unwrap_or(true);

        logging!(
            debug,
            Type::Hotkey,
            true,
            "Initializing global hotkeys: {}",
            enable_global_hotkey
        );

        if !enable_global_hotkey {
            return Ok(());
        }

        // Extract hotkeys data before async operations
        let hotkeys = verge.latest_ref().hotkeys.as_ref().cloned();

        if let Some(hotkeys) = hotkeys {
            logging!(
                debug,
                Type::Hotkey,
                true,
                "Has {} hotkeys need to register",
                hotkeys.len()
            );

            for hotkey in hotkeys.iter() {
                let mut iter = hotkey.split(',');
                let func = iter.next();
                let key = iter.next();

                match (key, func) {
                    (Some(key), Some(func)) => {
                        logging!(
                            debug,
                            Type::Hotkey,
                            true,
                            "Registering hotkey: {} -> {}",
                            key,
                            func
                        );
                        if let Err(e) = self.register(key, func).await {
                            logging!(
                                error,
                                Type::Hotkey,
                                true,
                                "Failed to register hotkey {} -> {}: {:?}",
                                key,
                                func,
                                e
                            );
                        } else {
                            logging!(
                                debug,
                                Type::Hotkey,
                                "Successfully registered hotkey {} -> {}",
                                key,
                                func
                            );
                        }
                    }
                    _ => {
                        let key = key.unwrap_or("None");
                        let func = func.unwrap_or("None");
                        logging!(
                            error,
                            Type::Hotkey,
                            true,
                            "Invalid hotkey configuration: `{}`:`{}`",
                            key,
                            func
                        );
                    }
                }
            }
            self.current.lock().clone_from(&hotkeys);
        } else {
            logging!(debug, Type::Hotkey, "No hotkeys configured");
        }

        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for hotkey registration"))?;
        let manager = app_handle.global_shortcut();
        manager.unregister_all()?;
        Ok(())
    }

    /// Register a hotkey with string-based function (backward compatibility)
    pub async fn register(&self, hotkey: &str, func: &str) -> Result<()> {
        let function = HotkeyFunction::from_str(func)?;
        self.register_hotkey_with_function(hotkey, function).await
    }

    pub fn unregister(&self, hotkey: &str) -> Result<()> {
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or_else(|| anyhow::anyhow!("Failed to get app handle for hotkey registration"))?;
        let manager = app_handle.global_shortcut();
        manager.unregister(hotkey)?;
        logging!(debug, Type::Hotkey, "Unregister hotkey {}", hotkey);
        Ok(())
    }

    pub async fn update(&self, new_hotkeys: Vec<String>) -> Result<()> {
        // Extract current hotkeys before async operations
        let current_hotkeys = self.current.lock().clone();
        let old_map = Self::get_map_from_vec(&current_hotkeys);
        let new_map = Self::get_map_from_vec(&new_hotkeys);

        let (del, add) = Self::get_diff(old_map, new_map);

        del.iter().for_each(|key| {
            let _ = self.unregister(key);
        });

        for (key, func) in add.iter() {
            logging_error!(Type::Hotkey, self.register(key, func).await);
        }

        // Update the current hotkeys after all async operations
        *self.current.lock() = new_hotkeys;
        Ok(())
    }

    fn get_map_from_vec(hotkeys: &[String]) -> HashMap<&str, &str> {
        let mut map = HashMap::new();

        hotkeys.iter().for_each(|hotkey| {
            let mut iter = hotkey.split(',');
            let func = iter.next();
            let key = iter.next();

            if let (Some(func), Some(key)) = (func, key) {
                let func = func.trim();
                let key = key.trim();
                map.insert(key, func);
            }
        });
        map
    }

    fn get_diff<'a>(
        old_map: HashMap<&'a str, &'a str>,
        new_map: HashMap<&'a str, &'a str>,
    ) -> (Vec<&'a str>, Vec<(&'a str, &'a str)>) {
        let mut del_list = vec![];
        let mut add_list = vec![];

        old_map.iter().for_each(|(&key, func)| {
            match new_map.get(key) {
                Some(new_func) => {
                    if new_func != func {
                        del_list.push(key);
                        add_list.push((key, *new_func));
                    }
                }
                None => del_list.push(key),
            };
        });

        new_map.iter().for_each(|(&key, &func)| {
            if !old_map.contains_key(key) {
                add_list.push((key, func));
            }
        });

        (del_list, add_list)
    }
}

impl Drop for Hotkey {
    fn drop(&mut self) {
        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => {
                logging!(
                    error,
                    Type::Hotkey,
                    "Failed to get app handle during hotkey cleanup"
                );
                return;
            }
        };
        if let Err(e) = app_handle.global_shortcut().unregister_all() {
            logging!(
                error,
                Type::Hotkey,
                true,
                "Error unregistering all hotkeys: {:?}",
                e
            );
        }
    }
}

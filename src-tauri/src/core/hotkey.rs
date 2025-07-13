use crate::utils::notification::{notify_event, NotificationEvent};
use crate::{
    config::Config, core::handle, feat, logging, logging_error,
    module::lightweight::entry_lightweight_mode, utils::logging::Type,
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};

pub struct Hotkey {
    current: Arc<Mutex<Vec<String>>>,
}

impl Hotkey {
    pub fn global() -> &'static Hotkey {
        static HOTKEY: OnceCell<Hotkey> = OnceCell::new();

        HOTKEY.get_or_init(|| Hotkey {
            current: Arc::new(Mutex::new(Vec::new())),
        })
    }

    pub fn init(&self) -> Result<()> {
        let verge = Config::verge();
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

        if let Some(hotkeys) = verge.latest_ref().hotkeys.as_ref() {
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
                        if let Err(e) = self.register(key, func) {
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
            self.current.lock().clone_from(hotkeys);
        } else {
            logging!(debug, Type::Hotkey, "No hotkeys configured");
        }

        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let manager = app_handle.global_shortcut();
        manager.unregister_all()?;
        Ok(())
    }

    pub fn register(&self, hotkey: &str, func: &str) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let manager = app_handle.global_shortcut();

        logging!(
            debug,
            Type::Hotkey,
            "Attempting to register hotkey: {} for function: {}",
            hotkey,
            func
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

        let app_handle_clone = app_handle.clone();
        let f: Box<dyn Fn() + Send + Sync> = match func.trim() {
            "open_or_close_dashboard" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    logging!(
                        debug,
                        Type::Hotkey,
                        true,
                        "=== Hotkey Dashboard Window Operation Start ==="
                    );

                    logging!(
                        info,
                        Type::Hotkey,
                        true,
                        "Using unified WindowManager for hotkey operation (bypass debounce)"
                    );

                    crate::feat::open_or_close_dashboard_hotkey();

                    logging!(
                        debug,
                        Type::Hotkey,
                        "=== Hotkey Dashboard Window Operation End ==="
                    );
                    notify_event(&app_handle, NotificationEvent::DashboardToggled);
                })
            }
            "clash_mode_rule" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::change_clash_mode("rule".into());
                    notify_event(
                        &app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Rule" },
                    );
                })
            }
            "clash_mode_global" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::change_clash_mode("global".into());
                    notify_event(
                        &app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Global" },
                    );
                })
            }
            "clash_mode_direct" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::change_clash_mode("direct".into());
                    notify_event(
                        &app_handle,
                        NotificationEvent::ClashModeChanged { mode: "Direct" },
                    );
                })
            }
            "toggle_system_proxy" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::toggle_system_proxy();
                    notify_event(&app_handle, NotificationEvent::SystemProxyToggled);
                })
            }
            "toggle_tun_mode" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::toggle_tun_mode(None);
                    notify_event(&app_handle, NotificationEvent::TunModeToggled);
                })
            }
            "entry_lightweight_mode" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    entry_lightweight_mode();
                    notify_event(&app_handle, NotificationEvent::LightweightModeEntered);
                })
            }
            "quit" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::quit();
                    notify_event(&app_handle, NotificationEvent::AppQuit);
                })
            }
            #[cfg(target_os = "macos")]
            "hide" => {
                let app_handle = app_handle_clone.clone();
                Box::new(move || {
                    feat::hide();
                    notify_event(&app_handle, NotificationEvent::AppHidden);
                })
            }
            _ => {
                logging!(error, Type::Hotkey, "Invalid function: {}", func);
                bail!("invalid function \"{func}\"");
            }
        };

        let is_quit = func.trim() == "quit";

        let _ = manager.on_shortcut(hotkey, move |app_handle, hotkey, event| {
            if event.state == ShortcutState::Pressed {
                logging!(debug, Type::Hotkey, "Hotkey pressed: {:?}", hotkey);

                if hotkey.key == Code::KeyQ && is_quit {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if window.is_focused().unwrap_or(false) {
                            logging!(debug, Type::Hotkey, "Executing quit function");
                            f();
                        }
                    }
                } else {
                    logging!(debug, Type::Hotkey, "Executing function directly");

                    let is_enable_global_hotkey = Config::verge()
                        .latest_ref()
                        .enable_global_hotkey
                        .unwrap_or(true);

                    if is_enable_global_hotkey {
                        f();
                    } else {
                        use crate::utils::window_manager::WindowManager;
                        let is_visible = WindowManager::is_main_window_visible();
                        let is_focused = WindowManager::is_main_window_focused();

                        if is_focused && is_visible {
                            f();
                        }
                    }
                }
            }
        });

        logging!(
            debug,
            Type::Hotkey,
            "Successfully registered hotkey {} for {}",
            hotkey,
            func
        );
        Ok(())
    }

    pub fn unregister(&self, hotkey: &str) -> Result<()> {
        let app_handle = handle::Handle::global().app_handle().unwrap();
        let manager = app_handle.global_shortcut();
        manager.unregister(hotkey)?;
        logging!(debug, Type::Hotkey, "Unregister hotkey {}", hotkey);
        Ok(())
    }

    pub fn update(&self, new_hotkeys: Vec<String>) -> Result<()> {
        let mut current = self.current.lock();
        let old_map = Self::get_map_from_vec(&current);
        let new_map = Self::get_map_from_vec(&new_hotkeys);

        let (del, add) = Self::get_diff(old_map, new_map);

        del.iter().for_each(|key| {
            let _ = self.unregister(key);
        });

        add.iter().for_each(|(key, func)| {
            logging_error!(Type::Hotkey, self.register(key, func));
        });

        *current = new_hotkeys;
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
        let app_handle = handle::Handle::global().app_handle().unwrap();
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

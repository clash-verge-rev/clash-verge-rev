use crate::{
    config::Config,
    core::handle,
    feat, logging, logging_error,
    module::lightweight::entry_lightweight_mode,
    utils::{logging::Type, resolve},
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::{async_runtime, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, ShortcutState};

pub struct Hotkey {
    current: Arc<Mutex<Vec<String>>>, // 保存当前的热键设置
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
        let enable_global_hotkey = verge.latest().enable_global_hotkey.unwrap_or(true);

        logging!(
            debug,
            Type::Hotkey,
            true,
            "Initializing global hotkeys: {}",
            enable_global_hotkey
        );

        // 如果全局热键被禁用，则不注册热键
        if !enable_global_hotkey {
            return Ok(());
        }

        if let Some(hotkeys) = verge.latest().hotkeys.as_ref() {
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

        let f = match func.trim() {
            "open_or_close_dashboard" => {
                logging!(
                    debug,
                    Type::Hotkey,
                    "Registering open_or_close_dashboard function"
                );
                || {
                    logging!(
                        debug,
                        Type::Hotkey,
                        true,
                        "=== Hotkey Dashboard Window Operation Start ==="
                    );

                    // 使用 spawn_blocking 来确保在正确的线程上执行
                    async_runtime::spawn_blocking(|| {
                        logging!(debug, Type::Hotkey, "Toggle dashboard window visibility");

                        // 检查窗口是否存在
                        if let Some(window) = handle::Handle::global().get_window() {
                            // 如果窗口可见，则隐藏它
                            if window.is_visible().unwrap_or(false) {
                                logging!(info, Type::Window, "Window is visible, hiding it");
                                let _ = window.hide();
                            } else {
                                // 如果窗口不可见，则显示它
                                logging!(info, Type::Window, "Window is hidden, showing it");
                                if window.is_minimized().unwrap_or(false) {
                                    let _ = window.unminimize();
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            // 如果窗口不存在，创建一个新窗口
                            logging!(
                                info,
                                Type::Window,
                                "Window does not exist, creating a new one"
                            );
                            resolve::create_window(true);
                        }
                    });

                    logging!(
                        debug,
                        Type::Hotkey,
                        "=== Hotkey Dashboard Window Operation End ==="
                    );
                }
            }
            "clash_mode_rule" => || feat::change_clash_mode("rule".into()),
            "clash_mode_global" => || feat::change_clash_mode("global".into()),
            "clash_mode_direct" => || feat::change_clash_mode("direct".into()),
            "toggle_system_proxy" => || feat::toggle_system_proxy(),
            "toggle_tun_mode" => || feat::toggle_tun_mode(None),
            "entry_lightweight_mode" => || entry_lightweight_mode(),
            "quit" => || feat::quit(Some(0)),
            #[cfg(target_os = "macos")]
            "hide" => || feat::hide(),

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
                    // 直接执行函数，不做任何状态检查
                    logging!(debug, Type::Hotkey, "Executing function directly");

                    // 获取全局热键状态
                    let is_enable_global_hotkey = Config::verge()
                        .latest()
                        .enable_global_hotkey
                        .unwrap_or(true);

                    if is_enable_global_hotkey {
                        f();
                    } else if let Some(window) = app_handle.get_webview_window("main") {
                        // 非轻量模式且未启用全局热键时，只在窗口可见且有焦点的情况下响应热键
                        let is_visible = window.is_visible().unwrap_or(false);
                        let is_focused = window.is_focused().unwrap_or(false);

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

            if func.is_some() && key.is_some() {
                let func = func.unwrap().trim();
                let key = key.unwrap().trim();
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

use crate::{config::Config, core::handle, feat, log_err, utils::resolve};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::{async_runtime, Manager};
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
        let verge_config = verge.latest();
        let enable_global_hotkey = verge_config.enable_global_hotkey.unwrap_or(true);

        log::info!(target: "app", "Initializing hotkeys, global hotkey enabled: {}", enable_global_hotkey);

        // If global hotkey is disabled, skip registration
        if !enable_global_hotkey {
            log::info!(target: "app", "Global hotkey is disabled, skipping registration");
            return Ok(());
        }

        if let Some(hotkeys) = verge_config.hotkeys.as_ref() {
            log::info!(target: "app", "Found {} hotkeys to register", hotkeys.len());

            // Pre-allocate the vector for current hotkeys
            let mut current = self.current.lock();
            current.clear();
            current.reserve(hotkeys.len());

            for hotkey in hotkeys.iter() {
                let mut iter = hotkey.split(',');
                let func = iter.next();
                let key = iter.next();

                match (key, func) {
                    (Some(key), Some(func)) => {
                        log::info!(target: "app", "Registering hotkey: {} -> {}", key, func);
                        if let Err(e) = self.register(key, func) {
                            log::error!(target: "app", "Failed to register hotkey {} -> {}: {:?}", key, func, e);
                        } else {
                            log::info!(target: "app", "Successfully registered hotkey {} -> {}", key, func);
                        }
                    }
                    _ => {
                        let key = key.unwrap_or("None");
                        let func = func.unwrap_or("None");
                        log::error!(target: "app", "Invalid hotkey configuration: `{key}`:`{func}`");
                    }
                }
            }

            // Use extend instead of clone_from to avoid reallocating
            current.extend(hotkeys.iter().cloned());
        } else {
            log::info!(target: "app", "No hotkeys configured");
        }

        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        if let Some(app_handle) = handle::Handle::global().app_handle() {
            app_handle.global_shortcut().unregister_all()?;
        }
        Ok(())
    }

    pub fn register(&self, hotkey: &str, func: &str) -> Result<()> {
        let app_handle = match handle::Handle::global().app_handle() {
            Some(handle) => handle,
            None => bail!("Failed to get app handle"),
        };
        let manager = app_handle.global_shortcut();

        log::info!(target: "app", "Attempting to register hotkey: {} for function: {}", hotkey, func);

        if manager.is_registered(hotkey) {
            log::info!(target: "app", "Hotkey {} was already registered, unregistering first", hotkey);
            manager.unregister(hotkey)?;
        }

        let f = match func.trim() {
            "open_or_close_dashboard" => {
                log::info!(target: "app", "Registering open_or_close_dashboard function");
                || {
                    log::info!(target: "app", "=== Hotkey Dashboard Window Operation Start ===");

                    async_runtime::spawn_blocking(|| {
                        log::info!(target: "app", "Toggle dashboard window visibility");

                        if let Some(window) = handle::Handle::global().get_window() {
                            if window.is_visible().unwrap_or(false) {
                                log::info!(target: "app", "Window is visible, hiding it");
                                let _ = window.hide();
                            } else {
                                log::info!(target: "app", "Window is hidden, showing it");
                                if window.is_minimized().unwrap_or(false) {
                                    let _ = window.unminimize();
                                }
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            log::info!(target: "app", "Window does not exist, creating a new one");
                            resolve::create_window();
                        }
                    });

                    log::info!(target: "app", "=== Hotkey Dashboard Window Operation End ===");
                }
            }
            "clash_mode_rule" => || feat::change_clash_mode("rule".into()),
            "clash_mode_global" => || feat::change_clash_mode("global".into()),
            "clash_mode_direct" => || feat::change_clash_mode("direct".into()),
            "toggle_system_proxy" => || feat::toggle_system_proxy(),
            "toggle_tun_mode" => || feat::toggle_tun_mode(None),
            "quit" => || feat::quit(Some(0)),

            _ => {
                log::error!(target: "app", "Invalid function: {}", func);
                bail!("invalid function \"{func}\"");
            }
        };

        let is_quit = func.trim() == "quit";

        let _ = manager.on_shortcut(hotkey, move |app_handle, hotkey, event| {
            if event.state == ShortcutState::Pressed {
                log::info!(target: "app", "Hotkey pressed: {:?}", hotkey);

                if hotkey.key == Code::KeyQ && is_quit {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if window.is_focused().unwrap_or(false) {
                            log::info!(target: "app", "Executing quit function");
                            f();
                        }
                    }
                } else {
                    log::info!(target: "app", "Executing function directly");

                    // Cache config values to avoid multiple lookups
                    let verge = Config::verge();
                    let verge_config = verge.latest();
                    let is_lite_mode = verge_config.enable_lite_mode.unwrap_or(false);
                    let is_enable_global_hotkey = verge_config.enable_global_hotkey.unwrap_or(true);

                    if is_lite_mode || is_enable_global_hotkey {
                        f();
                    } else if let Some(window) = app_handle.get_webview_window("main") {
                        let is_visible = window.is_visible().unwrap_or(false);
                        let is_focused = window.is_focused().unwrap_or(false);

                        if is_focused && is_visible {
                            f();
                        }
                    }
                }
            }
        });

        log::info!(target: "app", "Successfully registered hotkey {} for {}", hotkey, func);
        Ok(())
    }

    pub fn unregister(&self, hotkey: &str) -> Result<()> {
        if let Some(app_handle) = handle::Handle::global().app_handle() {
            app_handle.global_shortcut().unregister(hotkey)?;
            log::debug!(target: "app", "unregister hotkey {hotkey}");
        }
        Ok(())
    }

    pub fn update(&self, new_hotkeys: Vec<String>) -> Result<()> {
        // Create maps outside of lock to minimize lock duration
        let current = self.current.lock().clone();
        let old_map = Self::get_map_from_vec(&current);
        let new_map = Self::get_map_from_vec(&new_hotkeys);

        let (del, add) = Self::get_diff(old_map, new_map);

        // Unregister and register outside the lock
        for key in del {
            let _ = self.unregister(key);
        }

        for (key, func) in add {
            log_err!(self.register(key, func));
        }

        // Update current hotkeys with minimal lock duration
        let mut current = self.current.lock();
        *current = new_hotkeys;

        Ok(())
    }

    fn get_map_from_vec(hotkeys: &[String]) -> HashMap<&str, &str> {
        // Pre-allocate HashMap to avoid resizing
        let mut map = HashMap::with_capacity(hotkeys.len());

        for hotkey in hotkeys {
            let mut iter = hotkey.split(',');
            if let (Some(func), Some(key)) = (iter.next(), iter.next()) {
                let func = func.trim();
                let key = key.trim();
                map.insert(key, func);
            }
        }
        map
    }

    fn get_diff<'a>(
        old_map: HashMap<&'a str, &'a str>,
        new_map: HashMap<&'a str, &'a str>,
    ) -> (Vec<&'a str>, Vec<(&'a str, &'a str)>) {
        // Pre-allocate vectors with appropriate capacity
        let mut del_list = Vec::with_capacity(old_map.len());
        let mut add_list = Vec::with_capacity(new_map.len());

        // Find keys to delete or update
        for (&key, &func) in old_map.iter() {
            match new_map.get(key) {
                Some(&new_func) if new_func != func => {
                    del_list.push(key);
                    add_list.push((key, new_func));
                }
                None => del_list.push(key),
                _ => {} // Key exists with same function, no change needed
            }
        }

        // Find new keys to add
        for (&key, &func) in new_map.iter() {
            if !old_map.contains_key(key) {
                add_list.push((key, func));
            }
        }

        (del_list, add_list)
    }
}

impl Drop for Hotkey {
    fn drop(&mut self) {
        if let Some(app_handle) = handle::Handle::global().app_handle() {
            if let Err(e) = app_handle.global_shortcut().unregister_all() {
                log::error!(target:"app", "Error unregistering all hotkeys: {:?}", e);
            }
        }
    }
}

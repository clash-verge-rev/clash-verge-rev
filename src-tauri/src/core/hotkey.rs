use crate::{config::Config, core::handle, feat, log_err};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

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

        if let Some(hotkeys) = verge.latest().hotkeys.as_ref() {
            for hotkey in hotkeys.iter() {
                let mut iter = hotkey.split(',');
                let func = iter.next();
                let key = iter.next();

                match (key, func) {
                    (Some(key), Some(func)) => {
                        log_err!(self.register(key, func));
                    }
                    _ => {
                        let key = key.unwrap_or("None");
                        let func = func.unwrap_or("None");
                        tracing::error!("invalid hotkey `{key}`:`{func}`");
                    }
                }
            }
            self.current.lock().clone_from(hotkeys);
        }

        Ok(())
    }

    fn register(&self, hotkey: &str, func: &str) -> Result<()> {
        let app_handle = handle::Handle::get_app_handle();
        let manager = app_handle.global_shortcut();

        if manager.is_registered(hotkey) {
            manager.unregister(hotkey)?;
        }
        let f = match func.trim() {
            "open_or_close_dashboard" => || feat::open_or_close_dashboard(),
            "clash_mode_rule" => || feat::change_clash_mode("rule".into()),
            "clash_mode_global" => || feat::change_clash_mode("global".into()),
            "clash_mode_direct" => || feat::change_clash_mode("direct".into()),
            "toggle_system_proxy" => || feat::toggle_system_proxy(),
            "toggle_tun_mode" => || feat::toggle_tun_mode(),
            _ => bail!("invalid function \"{func}\""),
        };

        manager.on_shortcut(hotkey, move |_app, hotkey, event| {
            if let ShortcutState::Pressed = event.state {
                tracing::info!("hotkey [{}] pressed", hotkey);
                f();
            }
        })?;
        tracing::info!("register hotkey {hotkey} {func}");
        Ok(())
    }

    fn unregister(&self, hotkey: &str) -> Result<()> {
        let app_handle = handle::Handle::get_app_handle();
        app_handle.global_shortcut().unregister(hotkey)?;
        tracing::info!("unregister hotkey {hotkey}");
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
            log_err!(self.register(key, func));
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
        let app_handle = handle::Handle::get_app_handle();
        let shortcut = app_handle.global_shortcut();
        if let Err(e) = shortcut.unregister_all() {
            tracing::error!("unregister all hotkey error: {e}");
        }
    }
}

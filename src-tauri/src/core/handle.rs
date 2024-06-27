use super::tray::Tray;
use crate::{
    config::{Config, ConfigType},
    core::clash_api,
    log_err,
};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde_yaml::Mapping;
use std::{sync::Arc, thread::sleep, time::Duration};
use tauri::{AppHandle, Manager, Window};

#[derive(Debug, Default, Clone)]
pub struct Handle {
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl Handle {
    pub fn global() -> &'static Handle {
        static HANDLE: OnceCell<Handle> = OnceCell::new();

        HANDLE.get_or_init(|| Handle {
            app_handle: Arc::new(Mutex::new(None)),
        })
    }

    pub fn init(&self, app_handle: AppHandle) {
        *self.app_handle.lock() = Some(app_handle);
    }

    pub fn get_window(&self) -> Option<Window> {
        self.app_handle
            .lock()
            .as_ref()
            .and_then(|a| a.get_window("main"))
    }

    pub fn refresh_clash() {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://refresh-clash-config", "yes"));
        }
    }

    pub fn refresh_verge() {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://refresh-verge-config", "yes"));
        }
    }

    #[allow(unused)]
    pub fn refresh_profiles() {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://refresh-profiles-config", "yes"));
        }
    }

    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        if let Some(window) = Self::global().get_window() {
            log_err!(window.emit("verge://notice-message", (status.into(), msg.into())));
        }
    }

    pub fn update_systray() -> Result<()> {
        let app_handle = Self::global().app_handle.lock();
        if app_handle.is_none() {
            bail!("update_systray unhandled error");
        }
        Tray::update_systray(app_handle.as_ref().unwrap())?;
        Ok(())
    }

    /// update the system tray state
    pub fn update_systray_part() -> Result<()> {
        let app_handle = Self::global().app_handle.lock();
        if app_handle.is_none() {
            bail!("update_systray unhandled error");
        }
        Tray::update_part(app_handle.as_ref().unwrap())?;
        Ok(())
    }

    pub fn init_tun_mode_by_api() -> Result<()> {
        tauri::async_runtime::spawn(async {
            for _ in 0..5 {
                let tun_enable = Config::clash().latest().get_enable_tun();
                let mut clash_configs = clash_api::get_configs().await.unwrap();
                let mut update = false;
                let tun_enable_by_api = clash_configs
                    .tun
                    .get("enable")
                    .map_or(false, |val| val.as_bool().unwrap_or(false));
                if tun_enable != tun_enable_by_api {
                    for i in 0..5 {
                        clash_configs = clash_api::get_configs().await.unwrap();
                        let tun_enable_by_api = clash_configs
                            .tun
                            .get("enable")
                            .map_or(false, |val| val.as_bool().unwrap_or(false));
                        if tun_enable == tun_enable_by_api {
                            break;
                        }
                        if i == 4 {
                            update = true;
                            break;
                        }
                        sleep(Duration::from_secs(3));
                    }
                }
                if update {
                    log::error!(target: "app", "verge config: tun enable [{:?}], clash core run: tun enable [{:?}]", tun_enable, tun_enable_by_api);
                    let mut mapping = Mapping::new();
                    let mut tun_val_mapping = Mapping::new();
                    tun_val_mapping.insert("enable".into(), tun_enable_by_api.into());
                    mapping.insert("tun".into(), tun_val_mapping.into());
                    Config::clash()
                        .latest()
                        .patch_and_merge_config(mapping.clone());
                    if Config::clash().latest().save_config().is_ok() {
                        Config::runtime().latest().patch_config(mapping);
                        log_err!(Config::generate_file(ConfigType::Run));
                        log_err!(Self::update_systray_part());
                    }
                }
            }
        });
        Ok(())
    }
}

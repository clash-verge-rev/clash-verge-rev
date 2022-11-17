use super::tray::Tray;
use crate::log_err;
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::sync::Arc;
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
            .map_or(None, |a| a.get_window("main"))
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
}

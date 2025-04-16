use super::tray::Tray;
use crate::{log_err, APP_HANDLE};
use anyhow::{anyhow, Ok, Result};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_mihomo::{Mihomo, MihomoExt};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{RwLockReadGuard, RwLockWriteGuard};

pub struct Handle;

impl Handle {
    pub fn get_app_handle() -> &'static AppHandle {
        APP_HANDLE.get().expect("failed to get app handle")
    }

    pub async fn get_mihomo_read() -> RwLockReadGuard<'static, Mihomo> {
        APP_HANDLE
            .get()
            .expect("failed to get app handle")
            .mihomo()
            .read()
            .await
    }

    pub async fn get_mihomo_write() -> RwLockWriteGuard<'static, Mihomo> {
        APP_HANDLE
            .get()
            .expect("failed to get app handle")
            .mihomo()
            .write()
            .await
    }

    pub fn get_window() -> Option<WebviewWindow> {
        let app_handle = Self::get_app_handle();
        app_handle
            .get_webview_window("main")
            .ok_or_else(|| anyhow!("get window error"))
            .ok()
    }

    pub fn refresh_clash() {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit("verge://refresh-clash-config", "yes"));
        }
    }

    pub fn refresh_verge() {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit("verge://refresh-verge-config", "yes"));
        }
    }

    pub fn refresh_profiles() {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit("verge://refresh-profiles", "yes"));
        }
    }

    pub fn notice_message<S: Into<String>, M: Into<String>>(status: S, msg: M) {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit("verge://notice-message", (status.into(), msg.into())));
        }
    }

    pub fn update_systray() -> Result<()> {
        let app_handle = Self::get_app_handle();
        Tray::update_systray(app_handle)?;
        Ok(())
    }

    /// update the system tray state
    pub fn update_systray_part() -> Result<()> {
        let app_handle = Self::get_app_handle();
        Tray::update_part(app_handle)?;
        Ok(())
    }

    pub fn set_tray_visible(visible: bool) -> Result<()> {
        let app_handle = Self::get_app_handle();
        Tray::set_tray_visible(app_handle, visible)?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn set_dock_visible(visible: bool) -> Result<()> {
        let app_handle = Self::get_app_handle();
        let _ = app_handle.set_dock_visibility(visible);
        Ok(())
    }

    pub fn notification<T: Into<String>, B: Into<String>>(title: T, body: B) -> Result<()> {
        let app_handle = Self::get_app_handle();
        let _ = app_handle
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
        Ok(())
    }

    pub fn show_block_dialog<T: Into<String>, M: Into<String>>(
        title: T,
        message: M,
        kind: MessageDialogKind,
        buttons: MessageDialogButtons,
    ) -> Result<bool> {
        let app_handle = Self::get_app_handle();
        let status = app_handle
            .dialog()
            .message(message)
            .title(title)
            .buttons(buttons)
            .kind(kind)
            .blocking_show();
        Ok(status)
    }
}

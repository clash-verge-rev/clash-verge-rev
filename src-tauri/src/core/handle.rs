use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_mihomo::{Mihomo, MihomoExt};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{RwLockReadGuard, RwLockWriteGuard};

use super::tray::Tray;
use crate::{
    APP_HANDLE, any_err,
    error::{AppError, AppResult},
    log_err,
};

pub struct Handle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NoticeStatus {
    Success,
    #[allow(unused)]
    Info,
    #[allow(unused)]
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
struct NoticeMsg {
    status: NoticeStatus,
    msg: String,
}

impl Handle {
    pub fn app_handle() -> &'static AppHandle {
        APP_HANDLE.get().expect("failed to get app handle")
    }

    pub async fn mihomo() -> RwLockReadGuard<'static, Mihomo> {
        Self::app_handle().mihomo().read().await
    }

    pub async fn mihomo_mut() -> RwLockWriteGuard<'static, Mihomo> {
        Self::app_handle().mihomo().write().await
    }

    pub fn get_window() -> Option<WebviewWindow> {
        Self::app_handle()
            .get_webview_window("main")
            .ok_or(any_err!("get window error"))
            .ok()
    }

    pub fn refresh_websocket() {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit("verge://refresh-websocket", "yes"));
        }
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

    /// notification message on the front-end that the message will be converted according to the front-end i18n native language
    pub fn notice_message<M: Into<String>>(status: NoticeStatus, msg: M) {
        if let Some(window) = Self::get_window() {
            log_err!(window.emit(
                "verge://notice-message",
                NoticeMsg {
                    status,
                    msg: msg.into()
                }
            ));
        }
    }

    pub fn update_systray() -> AppResult<()> {
        Tray::update_systray(Self::app_handle())?;
        Ok(())
    }

    /// update the system tray state
    pub fn update_systray_part() -> AppResult<()> {
        Tray::update_part(Self::app_handle())?;
        Ok(())
    }

    pub fn set_tray_visible(visible: bool) -> AppResult<()> {
        Tray::set_tray_visible(Self::app_handle(), visible)?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn set_dock_visible(visible: bool) -> AppResult<()> {
        log_err!(
            Self::app_handle().set_dock_visibility(visible),
            "failed to set visible in macos dock"
        );
        Ok(())
    }

    pub fn notify<T: Into<String>, B: Into<String>>(title: T, body: B) {
        let notification = Self::app_handle().notification().builder().title(title).body(body);
        log_err!(notification.show(), "failed to show notification");
    }

    pub fn show_block_dialog<T: Into<String>, M: Into<String>>(
        title: T,
        message: M,
        kind: MessageDialogKind,
        buttons: MessageDialogButtons,
    ) -> AppResult<bool> {
        let status = Self::app_handle()
            .dialog()
            .message(message)
            .title(title)
            .buttons(buttons)
            .kind(kind)
            .blocking_show();
        Ok(status)
    }
}

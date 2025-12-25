//! Windows app theme watcher.
//!
//! NOTE:
//! Tauri's theme API is unreliable on Windows and may miss or delay
//! system theme change events. As a workaround, we poll the system
//! theme via the `dark-light` crate and emit a custom
//! `verge://app-theme-changed` event to keep the frontend in sync.
//!
//! Windows-only, best-effort.

use std::time::Duration;

use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::Emitter as _;

use crate::{core::handle, process::AsyncHandler};

const APP_THEME_EVENT: &str = "verge://app-theme-changed";

fn resolve_apps_theme_mode() -> Option<&'static str> {
    match detect_system_theme().ok()? {
        SystemTheme::Dark => Some("dark"),
        SystemTheme::Light => Some("light"),
        SystemTheme::Unspecified => None,
    }
}

pub fn start_windows_app_theme_watcher() {
    AsyncHandler::spawn(|| async move {
        let app_handle = handle::Handle::app_handle().clone();
        let mut last_theme = resolve_apps_theme_mode();

        if let Some(theme) = last_theme {
            let _ = app_handle.emit(APP_THEME_EVENT, theme);
        }

        loop {
            if handle::Handle::global().is_exiting() {
                break;
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
            let Some(theme) = resolve_apps_theme_mode() else {
                continue;
            };

            if last_theme.as_ref() == Some(&theme) {
                continue;
            }

            last_theme = Some(theme);
            let _ = app_handle.emit(APP_THEME_EVENT, theme);
        }
    });
}

use crate::core::{
    notification::{self, PendingFailure},
    runstate::{RUN_STATE, RunStateView},
};
use dark_light::{Mode as SystemTheme, detect as detect_system_theme};

/// Read the current desktop appearance from the platform theme source.
/// On Linux, dark-light reads org.freedesktop.appearance/color-scheme
/// through XDG Desktop Portal.
#[tauri::command]
pub fn get_system_theme() -> Result<Option<&'static str>, String> {
    detect_system_theme()
        .map(|theme| match theme {
            SystemTheme::Dark => Some("dark"),
            SystemTheme::Light => Some("light"),
            SystemTheme::Unspecified => None,
        })
        .map_err(|err| err.to_string())
}

/// The whole Run State in one call.
///
/// Replaces the separate running-mode and service-install-state commands: they were three
/// caches on three refresh intervals describing one fact, which the frontend then had to keep
/// coherent by hand.
#[tauri::command]
pub async fn get_runtime_state() -> Result<RunStateView, String> {
    Ok(RUN_STATE.settled().await.to_view())
}

/// Return unresolved failures without consuming them.
#[tauri::command]
pub async fn get_pending_failures() -> Vec<PendingFailure> {
    notification::pending_failures()
}

use parking_lot::RwLock;
use serde::Serialize;
use tauri::{AppHandle, Runtime, State, command};
use tauri_plugin_clipboard_manager::ClipboardExt as _;

use crate::Platform;

#[derive(Serialize, specta::Type)]
pub struct SystemInfo {
    pub system_name: String,
    pub system_version: String,
}

impl From<&Platform> for SystemInfo {
    fn from(platform: &Platform) -> Self {
        Self {
            system_name: platform.sysinfo.system_name.clone(),
            system_version: platform.sysinfo.system_version.clone(),
        }
    }
}

#[command]
#[specta::specta]
pub fn get_system_info(state: State<'_, RwLock<Platform>>) -> Result<SystemInfo, String> {
    let platform = state.inner().read();
    Ok(SystemInfo::from(&*platform))
}

/// 获取应用的运行时间（毫秒）
#[command]
#[specta::specta]
pub fn get_app_uptime(state: State<'_, RwLock<Platform>>) -> Result<u128, String> {
    Ok(state.inner().read().appinfo.app_startup_time.elapsed().as_millis())
}

#[command]
#[specta::specta]
pub fn export_diagnostic_info<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RwLock<Platform>>,
) -> Result<(), String> {
    let info = state.inner().read().to_string();
    let clipboard = app_handle.clipboard();
    clipboard.write_text(info).map_err(|error| error.to_string())
}

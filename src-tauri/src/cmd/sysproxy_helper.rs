#![cfg(target_os = "macos")]

use crate::core::sysproxy_helper;

#[tauri::command]
pub fn get_system_proxy_helper_status() -> sysproxy_helper::HelperStatus {
    sysproxy_helper::get_status()
}

#[tauri::command]
pub fn request_system_proxy_helper_install() -> sysproxy_helper::InstallResult {
    sysproxy_helper::install()
}

#[tauri::command]
pub fn is_system_proxy_helper_installed() -> bool {
    sysproxy_helper::is_installed()
}

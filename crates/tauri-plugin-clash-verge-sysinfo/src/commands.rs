use parking_lot::RwLock;
use tauri::{AppHandle, Runtime, State, command};
use tauri_plugin_clipboard_manager::{ClipboardExt as _, Error};

use crate::Platform;

// TODO 迁移，让新的结构体允许通过 tauri command 正确使用 structure.field 方式获取信息
#[command]
pub fn get_system_info(state: State<'_, RwLock<Platform>>) -> Result<String, Error> {
    Ok(state.inner().read().to_string())
}

/// 获取应用的运行时间（毫秒）
#[command]
pub fn get_app_uptime(state: State<'_, RwLock<Platform>>) -> Result<u128, Error> {
    Ok(state
        .inner()
        .read()
        .appinfo
        .app_startup_time
        .elapsed()
        .as_millis())
}

/// 检查应用是否以管理员身份运行
#[command]
pub fn app_is_admin(state: State<'_, RwLock<Platform>>) -> Result<bool, Error> {
    Ok(state.inner().read().appinfo.app_is_admin)
}

#[command]
pub fn export_diagnostic_info<R: Runtime>(
    app_handle: AppHandle<R>,
    state: State<'_, RwLock<Platform>>,
) -> Result<(), Error> {
    let info = state.inner().read().to_string();
    let clipboard = app_handle.clipboard();
    clipboard.write_text(info)
}

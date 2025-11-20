use std::sync::Arc;

use super::CmdResult;
use crate::core::{CoreManager, handle, manager::RunningMode};
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use tauri::Manager as _;
use tauri_plugin_clash_verge_sysinfo::Platform;
use tauri_plugin_clipboard_manager::ClipboardExt as _;

#[tauri::command]
pub async fn export_diagnostic_info() -> CmdResult<()> {
    let app_handle = handle::Handle::app_handle();
    let info = app_handle.state::<RwLock<Platform>>().read().to_string();

    let app_handle = handle::Handle::app_handle();
    let cliboard = app_handle.clipboard();
    if cliboard.write_text(info).is_err() {
        logging!(error, Type::System, "Failed to write to clipboard");
    }
    Ok(())
}

// TODO 迁移，让新的结构体允许通过 tauri command 正确使用 structure.field 方式获取信息
#[tauri::command]
pub async fn get_system_info() -> CmdResult<String> {
    let app_handle = handle::Handle::app_handle();
    let info = app_handle.state::<RwLock<Platform>>().read().to_string();
    Ok(info)
}

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<Arc<RunningMode>, String> {
    Ok(CoreManager::global().get_running_mode())
}

/// 获取应用的运行时间（毫秒）
#[tauri::command]
pub fn get_app_uptime() -> u128 {
    let app_handle = handle::Handle::app_handle();
    let startup_time = app_handle
        .state::<RwLock<Platform>>()
        .read()
        .appinfo
        .app_startup_time;
    startup_time.elapsed().as_millis()
}

/// 检查应用是否以管理员身份运行
#[tauri::command]
pub fn is_admin() -> bool {
    let app_handle = handle::Handle::app_handle();
    app_handle
        .state::<RwLock<Platform>>()
        .read()
        .appinfo
        .app_is_admin
}

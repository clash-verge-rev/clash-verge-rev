use std::sync::Arc;

use super::CmdResult;
use crate::{
    core::{CoreManager, handle, manager::RunningMode},
    logging,
    module::sysinfo::PlatformSpecification,
    utils::logging::Type,
};
#[cfg(target_os = "windows")]
use deelevate::{PrivilegeLevel, Token};
use once_cell::sync::Lazy;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tokio::time::Instant;

// 存储应用启动时间的全局变量
static APP_START_TIME: Lazy<Instant> = Lazy::new(Instant::now);
#[cfg(not(target_os = "windows"))]
static APPS_RUN_AS_ADMIN: Lazy<bool> = Lazy::new(|| unsafe { libc::geteuid() } == 0);
#[cfg(target_os = "windows")]
static APPS_RUN_AS_ADMIN: Lazy<bool> = Lazy::new(|| {
    Token::with_current_process()
        .and_then(|token| token.privilege_level())
        .map(|level| level != PrivilegeLevel::NotPrivileged)
        .unwrap_or(false)
});

#[tauri::command]
pub async fn export_diagnostic_info() -> CmdResult<()> {
    let sysinfo = PlatformSpecification::new_sync();
    let info = format!("{sysinfo:?}");

    let app_handle = handle::Handle::app_handle();
    let cliboard = app_handle.clipboard();
    if cliboard.write_text(info).is_err() {
        logging!(error, Type::System, "Failed to write to clipboard");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_system_info() -> CmdResult<String> {
    let sysinfo = PlatformSpecification::new_sync();
    let info = format!("{sysinfo:?}");
    Ok(info)
}

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<Arc<RunningMode>, String> {
    Ok(CoreManager::global().get_running_mode())
}

/// 获取应用的运行时间（毫秒）
#[tauri::command]
pub fn get_app_uptime() -> CmdResult<u128> {
    Ok(APP_START_TIME.elapsed().as_millis())
}

/// 检查应用是否以管理员身份运行
#[tauri::command]
pub fn is_admin() -> CmdResult<bool> {
    Ok(*APPS_RUN_AS_ADMIN)
}

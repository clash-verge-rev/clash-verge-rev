use super::CmdResult;
use crate::{
    core::{self, handle, service, CoreManager},
    module::sysinfo::PlatformSpecification,
    wrap_err,
};
use once_cell::sync::Lazy;
use std::{
    sync::atomic::{AtomicI64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri_plugin_clipboard_manager::ClipboardExt;

// 存储应用启动时间的全局变量
static APP_START_TIME: Lazy<AtomicI64> = Lazy::new(|| {
    // 获取当前系统时间，转换为毫秒级时间戳
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    AtomicI64::new(now)
});

#[tauri::command]
pub async fn export_diagnostic_info() -> CmdResult<()> {
    let sysinfo = PlatformSpecification::new();
    let info = format!("{:?}", sysinfo);

    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cliboard = app_handle.clipboard();
    if cliboard.write_text(info).is_err() {
        log::error!(target: "app", "Failed to write to clipboard");
    }
    Ok(())
}

#[tauri::command]
pub async fn get_system_info() -> CmdResult<String> {
    let sysinfo = PlatformSpecification::new();
    let info = format!("{:?}", sysinfo);
    Ok(info)
}

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<String, String> {
    match CoreManager::global().get_running_mode().await {
        core::RunningMode::Service => Ok("service".to_string()),
        core::RunningMode::Sidecar => Ok("sidecar".to_string()),
        core::RunningMode::NotRunning => Ok("not_running".to_string()),
    }
}

/// 安装/重装系统服务
#[tauri::command]
pub async fn install_service() -> CmdResult {
    wrap_err!(service::reinstall_service().await)
}

/// 获取应用的运行时间（毫秒）
#[tauri::command]
pub fn get_app_uptime() -> CmdResult<i64> {
    let start_time = APP_START_TIME.load(Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    Ok(now - start_time)
}

use super::CmdResult;
use crate::{
    core::{handle, CoreManager},
    module::sysinfo::PlatformSpecification,
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
    let sysinfo = PlatformSpecification::new_async().await;
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
    let sysinfo = PlatformSpecification::new_async().await;
    let info = format!("{:?}", sysinfo);
    Ok(info)
}

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<String, String> {
    Ok(CoreManager::global().get_running_mode().await.to_string())
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

/// 检查应用是否以管理员身份运行
#[tauri::command]
#[cfg(target_os = "windows")]
pub fn is_admin() -> CmdResult<bool> {
    use deelevate::{PrivilegeLevel, Token};

    let result = Token::with_current_process()
        .and_then(|token| token.privilege_level())
        .map(|level| level != PrivilegeLevel::NotPrivileged)
        .unwrap_or(false);

    Ok(result)
}

/// 非Windows平台检测是否以管理员身份运行
#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub fn is_admin() -> CmdResult<bool> {
    #[cfg(target_os = "macos")]
    {
        Ok(unsafe { libc::geteuid() } == 0)
    }

    #[cfg(target_os = "linux")]
    {
        Ok(unsafe { libc::geteuid() } == 0)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok(false)
    }
}

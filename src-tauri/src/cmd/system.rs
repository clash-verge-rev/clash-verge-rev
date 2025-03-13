use super::CmdResult;
use crate::{
    core::{self, handle, service, CoreManager},
    module::sysinfo::PlatformSpecification,
    wrap_err,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

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

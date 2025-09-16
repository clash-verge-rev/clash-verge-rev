use super::CmdResult;
use crate::{
    core::{
        CoreManager,
        service::{self, SERVICE_MANAGER, ServiceStatus},
    },
    utils::i18n::t,
};

async fn execute_service_operation_sync(status: ServiceStatus, op_type: &str) -> CmdResult {
    if let Err(e) = SERVICE_MANAGER
        .lock()
        .await
        .handle_service_status(&status)
        .await
    {
        let emsg = format!("{} Service failed: {}", op_type, e.to_string());
        return Err(t(emsg.as_str()).await);
    }
    if CoreManager::global().restart_core().await.is_err() {
        let emsg = format!("Restart Core failed");
        return Err(t(emsg.as_str()).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::UninstallRequired, "Uninstall").await
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ReinstallRequired, "Reinstall").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ForceReinstallRequired, "Repair").await
}

#[tauri::command]
pub async fn is_service_available() -> CmdResult<bool> {
    service::is_service_available()
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

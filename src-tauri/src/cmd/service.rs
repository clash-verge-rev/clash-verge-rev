use super::{CmdResult, StringifyErr as _};
use crate::core::{
    CoreManager,
    service::{self, SERVICE_MANAGER, ServiceStatus},
};

async fn execute_service_operation_sync(status: ServiceStatus, op_type: &str) -> CmdResult {
    let manager = CoreManager::global();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if matches!(
        &status,
        ServiceStatus::ReinstallRequired | ServiceStatus::ForceReinstallRequired
    ) {
        manager
            .controlled_stop_core_inner()
            .await
            .map_err(|error| format!("{op_type} Service failed: {error:#}"))?;
    }
    SERVICE_MANAGER
        .handle_service_status(status)
        .await
        .map_err(|e| format!("{op_type} Service failed: {e}").into())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    CoreManager::global()
        .uninstall_service_and_start_sidecar()
        .await
        .map_err(|error| format!("Uninstall Service failed: {error:#}").into())
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
    Ok(service::is_service_available().await)
}

#[tauri::command]
pub async fn get_service_install_state() -> CmdResult<service::ServiceInstallState> {
    Ok(SERVICE_MANAGER.install_state().await)
}

#[tauri::command]
pub async fn continue_with_sidecar() -> CmdResult {
    crate::core::CoreManager::global()
        .continue_with_sidecar()
        .await
        .stringify_err()
}

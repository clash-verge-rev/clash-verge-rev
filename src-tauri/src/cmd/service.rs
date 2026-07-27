use super::{CmdResult, WithErrorCode as _};
use crate::core::{
    CoreManager,
    service::{SERVICE_MANAGER, ServiceStatus},
};

async fn execute_service_operation_sync(status: ServiceStatus, error_code: &str) -> CmdResult {
    let manager = CoreManager::global();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if matches!(
        &status,
        ServiceStatus::ReinstallRequired | ServiceStatus::ForceReinstallRequired
    ) {
        manager.controlled_stop_core_inner().await.with_error_code(error_code)?;
    }
    SERVICE_MANAGER
        .handle_service_status(status)
        .await
        .with_error_code(error_code)
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::InstallRequired, "SERVICE_INSTALL_FAILED").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    CoreManager::global()
        .uninstall_service_and_start_sidecar()
        .await
        .with_error_code("SERVICE_UNINSTALL_FAILED")
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ReinstallRequired, "SERVICE_REINSTALL_FAILED").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation_sync(ServiceStatus::ForceReinstallRequired, "SERVICE_REPAIR_FAILED").await
}

#[tauri::command]
pub async fn continue_with_sidecar() -> CmdResult {
    crate::core::CoreManager::global()
        .continue_with_sidecar()
        .await
        .with_error_code("SERVICE_SIDECAR_FAILED")
}

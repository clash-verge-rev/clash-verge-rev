use super::{CmdResult, proxy_aware_coded_error};
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
        manager
            .controlled_stop_core_inner()
            .await
            .map_err(|error| proxy_aware_coded_error(&error, error_code))?;
    }
    SERVICE_MANAGER
        .handle_service_status(status)
        .await
        .map_err(|error| proxy_aware_coded_error(&error, error_code))
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
        .map_err(|error| proxy_aware_coded_error(&error, "SERVICE_UNINSTALL_FAILED"))
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
pub async fn open_service_settings() -> CmdResult {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        crate::core::handle::Handle::app_handle()
            .run_on_main_thread(move || {
                let _ = sender.send(crate::core::macos_service::open_settings());
            })
            .map_err(|error| super::coded_error("SERVICE_SETTINGS_FAILED", error))?;
        receiver
            .await
            .map_err(|error| super::coded_error("SERVICE_SETTINGS_FAILED", error))?
            .map_err(|error| super::coded_error("SERVICE_SETTINGS_FAILED", error))
    }
    #[cfg(not(target_os = "macos"))]
    Err(super::coded_error(
        "SERVICE_SETTINGS_FAILED",
        "当前系统不支持此服务批准页面",
    ))
}

#[tauri::command]
pub async fn continue_with_sidecar() -> CmdResult {
    crate::core::CoreManager::global()
        .continue_with_sidecar()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "SERVICE_SIDECAR_FAILED"))
}

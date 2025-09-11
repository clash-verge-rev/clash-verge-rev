use super::CmdResult;
use crate::{
    core::{CoreManager, service},
    utils::i18n::t,
};
use anyhow::Result;

async fn execute_service_operation_sync<F, Fut, E>(service_op: F, op_type: &str) -> CmdResult
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), E>>,
    E: ToString + std::fmt::Debug,
{
    if let Err(e) = service_op().await {
        let emsg = format!("{} {} failed: {}", op_type, "Service", e.to_string());
        return Err(t(emsg.as_str()).await);
    }
    if CoreManager::global().restart_core().await.is_err() {
        let emsg = format!("{} {} failed", "Restart", "Core");
        return Err(t(emsg.as_str()).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation_sync(service::install_service, "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    execute_service_operation_sync(service::uninstall_service, "Uninstall").await
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation_sync(service::reinstall_service, "Reinstall").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation_sync(service::force_reinstall_service, "Repair").await
}

#[tauri::command]
pub async fn is_service_available() -> CmdResult<bool> {
    service::is_service_available()
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

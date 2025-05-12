use super::CmdResult;
use crate::{
    core::{service, CoreManager},
    utils::i18n::t,
};

async fn execute_service_operation(
    service_op: impl std::future::Future<Output = Result<(), impl ToString + std::fmt::Debug>>,
    op_type: &str,
) -> CmdResult {
    if service_op.await.is_err() {
        let emsg = format!("{} {} failed", op_type, "Service");
        return Err(t(emsg.as_str()));
    }
    if CoreManager::global().restart_core().await.is_err() {
        let emsg = format!("{} {} failed", "Restart", "Core");
        return Err(t(emsg.as_str()));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    execute_service_operation(service::install_service(), "Install").await
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    execute_service_operation(service::uninstall_service(), "Uninstall").await
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    execute_service_operation(service::reinstall_service(), "Reinstall").await
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    execute_service_operation(service::force_reinstall_service(), "Repair").await
}

#[tauri::command]
pub async fn is_service_available() -> CmdResult<bool> {
    service::is_service_available()
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}

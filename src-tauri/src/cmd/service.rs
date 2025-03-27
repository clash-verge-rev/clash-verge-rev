use super::CmdResult;
use crate::{
    core::{service, CoreManager},
    logging_error,
    utils::logging::Type,
};

async fn execute_service_operation(
    service_op: impl std::future::Future<Output = Result<(), impl ToString + std::fmt::Debug>>,
    op_type: &str,
) -> CmdResult {
    if let Err(e) = service_op.await {
        let emsg = format!("{} {} failed: {:?}", op_type, "service", e);
        logging_error!(Type::Service, true, "{}", emsg);
        return Err(emsg);
    }
    if let Err(e) = CoreManager::global().restart_core().await {
        let emsg = format!("{} {} failed: {:?}", op_type, "core", e);
        logging_error!(Type::Core, true, "{}", emsg);
        return Err(emsg);
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

use super::CmdResult;
use crate::{
    core::{service, CoreManager},
    logging_error,
    utils::logging::Type,
};

#[tauri::command]
pub async fn install_service() -> CmdResult {
    logging_error!(Type::Service, true, service::install_service().await);
    logging_error!(Type::Core, true, CoreManager::global().restart_core().await);
    Ok(())
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    logging_error!(Type::Service, true, service::uninstall_service().await);
    logging_error!(Type::Core, true, CoreManager::global().restart_core().await);
    Ok(())
}

#[tauri::command]
pub async fn reinstall_service() -> CmdResult {
    logging_error!(Type::Service, true, service::reinstall_service().await);
    logging_error!(Type::Core, true, CoreManager::global().restart_core().await);
    Ok(())
}

#[tauri::command]
pub async fn repair_service() -> CmdResult {
    logging_error!(
        Type::Service,
        true,
        service::force_reinstall_service().await
    );
    logging_error!(Type::Core, true, CoreManager::global().restart_core().await);
    Ok(())
}

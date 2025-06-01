use crate::{core::service, utils, wrap_err};

use super::CmdResult;

#[tauri::command]
pub async fn check_service() -> CmdResult<service::JsonResponse<service::ClashStatus>> {
    wrap_err!(service::check_service().await)
}

#[tauri::command]
pub async fn install_service() -> CmdResult {
    wrap_err!(service::install_service().await)?;
    wrap_err!(utils::crypto::reload_keys())
}

#[tauri::command]
pub async fn uninstall_service() -> CmdResult {
    wrap_err!(service::stop_service().await)?;
    wrap_err!(service::uninstall_service().await)
}

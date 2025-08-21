use crate::{core::service, error::AppResult, utils};

#[tauri::command]
pub async fn check_service() -> AppResult<service::JsonResponse<service::ClashStatus>> {
    service::check_service().await
}

#[tauri::command]
pub async fn install_service() -> AppResult<()> {
    service::install_service().await?;
    utils::crypto::reload_keys()
}

#[tauri::command]
pub async fn uninstall_service() -> AppResult<()> {
    service::stop_service().await?;
    service::uninstall_service().await
}

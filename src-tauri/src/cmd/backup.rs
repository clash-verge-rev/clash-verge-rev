use super::CmdResult;
use crate::{cmd::StringifyErr as _, feat};
use feat::LocalBackupFile;
use smartstring::alias::String;

#[tauri::command]
pub async fn create_local_backup() -> CmdResult<()> {
    feat::create_local_backup().await.stringify_err()
}

#[tauri::command]
pub async fn list_local_backup() -> CmdResult<Vec<LocalBackupFile>> {
    feat::list_local_backup().await.stringify_err()
}

#[tauri::command]
pub async fn delete_local_backup(filename: String) -> CmdResult<()> {
    feat::delete_local_backup(filename).await.stringify_err()
}

#[tauri::command]
pub async fn restore_local_backup(filename: String) -> CmdResult<()> {
    feat::restore_local_backup(filename)
        .await
        .map_err(|error| super::proxy_aware_error(&error))
}

#[tauri::command]
pub async fn import_local_backup(source: String) -> CmdResult<String> {
    feat::import_local_backup(source).await.stringify_err()
}

#[tauri::command]
pub async fn export_local_backup(filename: String, destination: String) -> CmdResult<()> {
    feat::export_local_backup(filename, destination).await.stringify_err()
}

use super::CmdResult;
use crate::{cmd::StringifyErr as _, feat};
use feat::LocalBackupFile;
use tristr::alias::String;

#[tauri::command]
#[specta::specta]
pub async fn create_local_backup() -> CmdResult<()> {
    feat::create_local_backup().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn list_local_backup() -> CmdResult<Vec<LocalBackupFile>> {
    feat::list_local_backup().await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn delete_local_backup(filename: String) -> CmdResult<()> {
    let filename: String = filename;
    feat::delete_local_backup(filename).await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn restore_local_backup(filename: String) -> CmdResult<()> {
    let filename: String = filename;
    feat::restore_local_backup(filename)
        .await
        .map_err(|error| super::proxy_aware_error(&error))
}

#[tauri::command]
#[specta::specta]
pub async fn import_local_backup(source: String) -> CmdResult<String> {
    let source: String = source;
    feat::import_local_backup(source).await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn export_local_backup(filename: String, destination: String) -> CmdResult<()> {
    let filename: String = filename;
    let destination: String = destination;
    feat::export_local_backup(filename, destination).await.stringify_err()
}

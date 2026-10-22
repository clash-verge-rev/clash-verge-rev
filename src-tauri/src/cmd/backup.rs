use super::CmdResult;
use crate::{cmd::StringifyErr as _, feat};
use feat::LocalBackupFile;
use smartstring::alias::String;

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
pub async fn delete_local_backup(filename: std::string::String) -> CmdResult<()> {
    let filename: String = filename.into();
    feat::delete_local_backup(filename).await.stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn restore_local_backup(filename: std::string::String) -> CmdResult<()> {
    let filename: String = filename.into();
    feat::restore_local_backup(filename)
        .await
        .map_err(|error| super::proxy_aware_error(&error))
}

#[tauri::command]
#[specta::specta]
pub async fn import_local_backup(source: std::string::String) -> CmdResult<std::string::String> {
    let source: String = source.into();
    feat::import_local_backup(source).await.map(Into::into).stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn export_local_backup(filename: std::string::String, destination: std::string::String) -> CmdResult<()> {
    let filename: String = filename.into();
    let destination: String = destination.into();
    feat::export_local_backup(filename, destination).await.stringify_err()
}

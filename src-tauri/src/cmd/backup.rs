use super::CmdResult;
use crate::{cmd::StringifyErr as _, feat};
use feat::LocalBackupFile;
use smartstring::alias::String;

/// Create a local backup
#[tauri::command]
pub async fn create_local_backup() -> CmdResult<()> {
    feat::create_local_backup().await.stringify_err()
}

/// List local backups
#[tauri::command]
pub async fn list_local_backup() -> CmdResult<Vec<LocalBackupFile>> {
    feat::list_local_backup().await.stringify_err()
}

/// Delete local backup
#[tauri::command]
pub async fn delete_local_backup(filename: String) -> CmdResult<()> {
    feat::delete_local_backup(filename).await.stringify_err()
}

/// Restore local backup
#[tauri::command]
pub async fn restore_local_backup(filename: String) -> CmdResult<()> {
    feat::restore_local_backup(filename).await.stringify_err()
}

/// Export local backup to a user selected destination
#[tauri::command]
pub async fn export_local_backup(filename: String, destination: String) -> CmdResult<()> {
    feat::export_local_backup(filename, destination).await.stringify_err()
}

use super::CmdResult;
use crate::{feat, wrap_err};
use feat::LocalBackupFile;

/// Create a local backup
#[tauri::command]
pub async fn create_local_backup() -> CmdResult<()> {
    wrap_err!(feat::create_local_backup().await)
}

/// List local backups
#[tauri::command]
pub fn list_local_backup() -> CmdResult<Vec<LocalBackupFile>> {
    wrap_err!(feat::list_local_backup())
}

/// Delete local backup
#[tauri::command]
pub async fn delete_local_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::delete_local_backup(filename).await)
}

/// Restore local backup
#[tauri::command]
pub async fn restore_local_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::restore_local_backup(filename).await)
}

/// Export local backup to a user selected destination
#[tauri::command]
pub fn export_local_backup(filename: String, destination: String) -> CmdResult<()> {
    wrap_err!(feat::export_local_backup(filename, destination))
}

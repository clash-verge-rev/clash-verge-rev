use super::CmdResult;
use crate::{
    config::Config,
    core::backup::{self, WebDav},
    utils::{self, dirs, resolve::resolve_reset},
    wrap_err,
};
use reqwest_dav::list_cmd::ListFile;
use std::{fs, path::PathBuf};

#[tauri::command]
pub async fn create_local_backup(only_backup_profiles: bool) -> CmdResult<(String, PathBuf)> {
    let (file_name, file_path) = backup::create_backup(true, only_backup_profiles).unwrap();
    Ok((file_name, file_path))
}

#[tauri::command]
pub async fn apply_local_backup(app_handle: tauri::AppHandle, file_path: String) -> CmdResult {
    let file = wrap_err!(fs::File::open(file_path))?;
    let mut zip: zip::ZipArchive<fs::File> = wrap_err!(zip::ZipArchive::new(file))?;
    wrap_err!(zip.extract(dirs::app_home_dir().unwrap()))?;
    wrap_err!(
        Config::reload().await,
        "download backup file success, but reload config failed"
    )?;
    utils::server::shutdown_embedded_server();
    resolve_reset().await;
    std::env::set_var("ApplyBackup", "true");
    app_handle.restart();
}

// web dav
#[tauri::command]
pub async fn update_webdav_info(url: String, username: String, password: String) -> CmdResult {
    wrap_err!(
        WebDav::global()
            .update_webdav_info(url, username, password)
            .await,
        "update webdav info failed"
    )
}

#[tauri::command]
pub async fn create_and_upload_backup(only_backup_profiles: bool) -> CmdResult {
    let (file_name, file_path) = backup::create_backup(false, only_backup_profiles).unwrap();
    wrap_err!(WebDav::upload_file(file_path, file_name).await)
}

#[tauri::command]
pub async fn list_backup() -> CmdResult<Vec<ListFile>> {
    wrap_err!(WebDav::list_file().await)
}

#[tauri::command]
pub async fn download_backup_and_reload(
    app_handle: tauri::AppHandle,
    file_name: String,
) -> CmdResult {
    let backup_archive = wrap_err!(dirs::backup_archive_file())?;
    wrap_err!(
        WebDav::download_file(file_name, backup_archive.clone()).await,
        "download backup file failed"
    )?;
    let file = wrap_err!(
        fs::File::open(backup_archive),
        "Failed to open backup archive"
    )?;
    // extract zip file
    let mut zip = wrap_err!(zip::ZipArchive::new(file), "Failed to create zip archive")?;
    wrap_err!(zip.extract(wrap_err!(dirs::app_home_dir())?))?;
    wrap_err!(
        Config::reload().await,
        "download backup file success, but reload config failed"
    )?;
    utils::server::shutdown_embedded_server();
    resolve_reset().await;
    std::env::set_var("ApplyBackup", "true");
    app_handle.restart();
}

#[tauri::command]
pub async fn delete_backup(file_name: String) -> CmdResult {
    wrap_err!(WebDav::delete_file(file_name).await)
}

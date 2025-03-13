use crate::{
    config::{Config, IVerge},
    core::backup,
    log_err,
    utils::dirs::app_home_dir,
};
use anyhow::Result;
use reqwest_dav::list_cmd::ListFile;
use std::fs;

/// Create a backup and upload to WebDAV
pub async fn create_backup_and_upload_webdav() -> Result<()> {
    let (file_name, temp_file_path) = backup::create_backup().map_err(|err| {
        log::error!(target: "app", "Failed to create backup: {:#?}", err);
        err
    })?;

    if let Err(err) = backup::WebDavClient::global()
        .upload(temp_file_path.clone(), file_name)
        .await
    {
        log::error!(target: "app", "Failed to upload to WebDAV: {:#?}", err);
        return Err(err);
    }

    if let Err(err) = std::fs::remove_file(&temp_file_path) {
        log::warn!(target: "app", "Failed to remove temp file: {:#?}", err);
    }

    Ok(())
}

/// List WebDAV backups
pub async fn list_wevdav_backup() -> Result<Vec<ListFile>> {
    backup::WebDavClient::global().list().await.map_err(|err| {
        log::error!(target: "app", "Failed to list WebDAV backup files: {:#?}", err);
        err
    })
}

/// Delete WebDAV backup
pub async fn delete_webdav_backup(filename: String) -> Result<()> {
    backup::WebDavClient::global()
        .delete(filename)
        .await
        .map_err(|err| {
            log::error!(target: "app", "Failed to delete WebDAV backup file: {:#?}", err);
            err
        })
}

/// Restore WebDAV backup
pub async fn restore_webdav_backup(filename: String) -> Result<()> {
    let verge = Config::verge();
    let verge_data = verge.data().clone();
    let webdav_url = verge_data.webdav_url.clone();
    let webdav_username = verge_data.webdav_username.clone();
    let webdav_password = verge_data.webdav_password.clone();

    let backup_storage_path = app_home_dir().unwrap().join(&filename);
    backup::WebDavClient::global()
        .download(filename, backup_storage_path.clone())
        .await
        .map_err(|err| {
            log::error!(target: "app", "Failed to download WebDAV backup file: {:#?}", err);
            err
        })?;

    // extract zip file
    let mut zip = zip::ZipArchive::new(fs::File::open(backup_storage_path.clone())?)?;
    zip.extract(app_home_dir()?)?;

    log_err!(
        super::patch_verge(
            IVerge {
                webdav_url,
                webdav_username,
                webdav_password,
                ..IVerge::default()
            },
            false
        )
        .await
    );
    // 最后删除临时文件
    fs::remove_file(backup_storage_path)?;
    Ok(())
}

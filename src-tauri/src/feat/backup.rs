use crate::{
    config::{Config, IVerge},
    core::backup,
    logging, logging_error,
    utils::{
        dirs::{PathBufExec, app_home_dir, local_backup_dir},
        logging::Type,
    },
};
use anyhow::{Result, anyhow};
use chrono::Utc;
use reqwest_dav::list_cmd::ListFile;
use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Debug, Serialize)]
pub struct LocalBackupFile {
    pub filename: String,
    pub path: String,
    pub last_modified: String,
    pub content_length: u64,
}

/// Create a backup and upload to WebDAV
pub async fn create_backup_and_upload_webdav() -> Result<()> {
    let (file_name, temp_file_path) = backup::create_backup().map_err(|err| {
        logging!(error, Type::Backup, "Failed to create backup: {err:#?}");
        err
    })?;

    if let Err(err) = backup::WebDavClient::global()
        .upload(temp_file_path.clone(), file_name)
        .await
    {
        logging!(error, Type::Backup, "Failed to upload to WebDAV: {err:#?}");
        // 上传失败时重置客户端缓存
        backup::WebDavClient::global().reset();
        return Err(err);
    }

    if let Err(err) = temp_file_path.remove_if_exists().await {
        logging!(warn, Type::Backup, "Failed to remove temp file: {err:#?}");
    }

    Ok(())
}

/// List WebDAV backups
pub async fn list_wevdav_backup() -> Result<Vec<ListFile>> {
    backup::WebDavClient::global().list().await.map_err(|err| {
        logging!(
            error,
            Type::Backup,
            "Failed to list WebDAV backup files: {err:#?}"
        );
        err
    })
}

/// Delete WebDAV backup
pub async fn delete_webdav_backup(filename: String) -> Result<()> {
    backup::WebDavClient::global()
        .delete(filename)
        .await
        .map_err(|err| {
            logging!(
                error,
                Type::Backup,
                "Failed to delete WebDAV backup file: {err:#?}"
            );
            err
        })
}

/// Restore WebDAV backup
pub async fn restore_webdav_backup(filename: String) -> Result<()> {
    let verge = Config::verge().await;
    let verge_data = verge.latest_ref().clone();
    let webdav_url = verge_data.webdav_url.clone();
    let webdav_username = verge_data.webdav_username.clone();
    let webdav_password = verge_data.webdav_password.clone();

    let backup_storage_path = app_home_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app home dir: {e}"))?
        .join(&filename);
    backup::WebDavClient::global()
        .download(filename, backup_storage_path.clone())
        .await
        .map_err(|err| {
            logging!(
                error,
                Type::Backup,
                "Failed to download WebDAV backup file: {err:#?}"
            );
            err
        })?;

    // extract zip file
    let mut zip = zip::ZipArchive::new(fs::File::open(backup_storage_path.clone())?)?;
    zip.extract(app_home_dir()?)?;
    logging_error!(
        Type::Backup,
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
    backup_storage_path.remove_if_exists().await?;
    Ok(())
}

/// Create a backup and save to local storage
pub async fn create_local_backup() -> Result<()> {
    let (file_name, temp_file_path) = backup::create_backup().map_err(|err| {
        logging!(
            error,
            Type::Backup,
            "Failed to create local backup: {err:#?}"
        );
        err
    })?;

    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(&file_name);

    if let Err(err) = move_file(temp_file_path.clone(), target_path.clone()) {
        logging!(
            error,
            Type::Backup,
            "Failed to move local backup file: {err:#?}"
        );
        // 清理临时文件
        if let Err(clean_err) = temp_file_path.remove_if_exists().await {
            logging!(
                warn,
                Type::Backup,
                "Failed to remove temp backup file after move error: {clean_err:#?}"
            );
        }
        return Err(err);
    }

    Ok(())
}

fn move_file(from: PathBuf, to: PathBuf) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }

    match fs::rename(&from, &to) {
        Ok(_) => Ok(()),
        Err(rename_err) => {
            // Attempt copy + remove as fallback, covering cross-device moves
            logging!(
                warn,
                Type::Backup,
                "Failed to rename backup file directly, fallback to copy/remove: {rename_err:#?}"
            );
            fs::copy(&from, &to).map_err(|err| anyhow!("Failed to copy backup file: {err:#?}"))?;
            fs::remove_file(&from)
                .map_err(|err| anyhow!("Failed to remove temp backup file: {err:#?}"))?;
            Ok(())
        }
    }
}

/// List local backups
pub fn list_local_backup() -> Result<Vec<LocalBackupFile>> {
    let backup_dir = local_backup_dir()?;
    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let metadata = entry.metadata()?;
        let last_modified = metadata
            .modified()
            .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339())
            .unwrap_or_default();
        backups.push(LocalBackupFile {
            filename: file_name.to_string(),
            path: path.to_string_lossy().to_string(),
            last_modified,
            content_length: metadata.len(),
        });
    }

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

/// Delete local backup
pub async fn delete_local_backup(filename: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(&filename);
    if !target_path.exists() {
        logging!(
            warn,
            Type::Backup,
            "Local backup file not found: {}",
            filename
        );
        return Ok(());
    }
    target_path.remove_if_exists().await?;
    Ok(())
}

/// Restore local backup
pub async fn restore_local_backup(filename: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(&filename);
    if !target_path.exists() {
        return Err(anyhow!("Backup file not found: {}", filename));
    }

    let verge = Config::verge().await;
    let verge_data = verge.latest_ref().clone();
    let webdav_url = verge_data.webdav_url.clone();
    let webdav_username = verge_data.webdav_username.clone();
    let webdav_password = verge_data.webdav_password.clone();

    let mut zip = zip::ZipArchive::new(fs::File::open(&target_path)?)?;
    zip.extract(app_home_dir()?)?;
    logging_error!(
        Type::Backup,
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
    Ok(())
}

/// Export local backup file to user selected destination
pub fn export_local_backup(filename: String, destination: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let source_path = backup_dir.join(&filename);
    if !source_path.exists() {
        return Err(anyhow!("Backup file not found: {}", filename));
    }

    let dest_path = PathBuf::from(destination);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(&source_path, &dest_path)
        .map(|_| ())
        .map_err(|err| anyhow!("Failed to export backup file: {err:#?}"))?;
    Ok(())
}

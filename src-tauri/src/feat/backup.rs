use crate::{
    config::{Config, IVerge},
    core::backup,
    process::AsyncHandler,
    utils::{
        dirs::{PathBufExec as _, app_home_dir, local_backup_dir, verge_path},
        help,
    },
};
use anyhow::{Result, anyhow};
use chrono::Utc;
use clash_verge_logging::{Type, logging};
use reqwest_dav::list_cmd::ListFile;
use serde::Serialize;
use smartstring::alias::String;
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Serialize)]
pub struct LocalBackupFile {
    pub filename: String,
    pub path: String,
    pub last_modified: String,
    pub content_length: u64,
}

/// Load restored verge.yaml from disk, merge back WebDAV creds, save, and sync memory.
async fn finalize_restored_verge_config(
    webdav_url: Option<String>,
    webdav_username: Option<String>,
    webdav_password: Option<String>,
) -> Result<()> {
    // Do NOT silently fallback to defaults; a broken/missing verge.yaml means restore failed.
    // Propagate the error so the UI/user can react accordingly.
    let mut restored = help::read_yaml::<IVerge>(&verge_path()?).await?;
    restored.webdav_url = webdav_url;
    restored.webdav_username = webdav_username;
    restored.webdav_password = webdav_password;
    restored.save_file().await?;

    let verge_draft = Config::verge().await;
    verge_draft.edit_draft(|d| {
        *d = restored.clone();
    });
    verge_draft.apply();

    // Ensure side-effects (flags, tray, sysproxy, hotkeys, auto-backup refresh, etc.) run.
    // Use not_save_file = true to avoid extra I/O (we already persisted the restored file).
    if let Err(err) = super::patch_verge(&restored, true).await {
        logging!(error, Type::Backup, "Failed to apply restored verge config: {err:#?}");
    }
    Ok(())
}

/// Create a backup and upload to WebDAV
pub async fn create_backup_and_upload_webdav() -> Result<()> {
    let (file_name, temp_file_path) = backup::create_backup().await.map_err(|err| {
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
        logging!(error, Type::Backup, "Failed to list WebDAV backup files: {err:#?}");
        err
    })
}

/// Delete WebDAV backup
pub async fn delete_webdav_backup(filename: String) -> Result<()> {
    backup::WebDavClient::global().delete(filename).await.map_err(|err| {
        logging!(error, Type::Backup, "Failed to delete WebDAV backup file: {err:#?}");
        err
    })
}

/// Restore WebDAV backup
pub async fn restore_webdav_backup(filename: String) -> Result<()> {
    let verge = Config::verge().await;
    let verge_data = verge.latest_arc();
    let webdav_url = verge_data.webdav_url.clone();
    let webdav_username = verge_data.webdav_username.clone();
    let webdav_password = verge_data.webdav_password.clone();

    let backup_storage_path = app_home_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app home dir: {e}"))?
        .join(filename.as_str());
    backup::WebDavClient::global()
        .download(filename, backup_storage_path.clone())
        .await
        .map_err(|err| {
            logging!(error, Type::Backup, "Failed to download WebDAV backup file: {err:#?}");
            err
        })?;

    // extract zip file
    let value = backup_storage_path.clone();
    let file = AsyncHandler::spawn_blocking(move || std::fs::File::open(&value)).await??;
    let mut zip = zip::ZipArchive::new(file)?;
    zip.extract(app_home_dir()?)?;
    let res = finalize_restored_verge_config(webdav_url, webdav_username, webdav_password).await;
    // Finally remove the temp file (attempt cleanup even if finalize fails)
    let _ = backup_storage_path.remove_if_exists().await;
    res
}

/// Create a backup and save to local storage
pub async fn create_local_backup() -> Result<()> {
    create_local_backup_with_namer(|name| name.to_string().into())
        .await
        .map(|_| ())
}

pub async fn create_local_backup_with_namer<F>(namer: F) -> Result<String>
where
    F: FnOnce(&str) -> String,
{
    let (file_name, temp_file_path) = backup::create_backup().await.map_err(|err| {
        logging!(error, Type::Backup, "Failed to create local backup: {err:#?}");
        err
    })?;

    let backup_dir = local_backup_dir()?;
    let final_name = namer(file_name.as_str());
    let target_path = backup_dir.join(final_name.as_str());

    if let Err(err) = move_file(temp_file_path.clone(), target_path.clone()).await {
        logging!(error, Type::Backup, "Failed to move local backup file: {err:#?}");
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

    Ok(final_name)
}

async fn move_file(from: PathBuf, to: PathBuf) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).await?;
    }

    match fs::rename(&from, &to).await {
        Ok(_) => Ok(()),
        Err(rename_err) => {
            // Attempt copy + remove as fallback, covering cross-device moves
            logging!(
                warn,
                Type::Backup,
                "Failed to rename backup file directly, fallback to copy/remove: {rename_err:#?}"
            );
            fs::copy(&from, &to)
                .await
                .map_err(|err| anyhow!("Failed to copy backup file: {err:#?}"))?;
            fs::remove_file(&from)
                .await
                .map_err(|err| anyhow!("Failed to remove temp backup file: {err:#?}"))?;
            Ok(())
        }
    }
}

/// List local backups
pub async fn list_local_backup() -> Result<Vec<LocalBackupFile>> {
    let backup_dir = local_backup_dir()?;
    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let mut backups = Vec::new();
    let mut dir = fs::read_dir(&backup_dir).await?;
    while let Some(entry) = dir.next_entry().await? {
        let path = entry.path();
        let metadata = entry.metadata().await?;
        if !metadata.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name,
            None => continue,
        };
        let last_modified = metadata
            .modified()
            .map(|time| chrono::DateTime::<Utc>::from(time).to_rfc3339())
            .unwrap_or_default();
        backups.push(LocalBackupFile {
            filename: file_name.into(),
            path: path.to_string_lossy().into(),
            last_modified: last_modified.into(),
            content_length: metadata.len(),
        });
    }

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

/// Delete local backup
pub async fn delete_local_backup(filename: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(filename.as_str());
    if !target_path.exists() {
        logging!(warn, Type::Backup, "Local backup file not found: {}", filename);
        return Ok(());
    }
    target_path.remove_if_exists().await?;
    Ok(())
}

/// Restore local backup
pub async fn restore_local_backup(filename: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(filename.as_str());
    if !target_path.exists() {
        return Err(anyhow!("Backup file not found: {}", filename));
    }

    let (webdav_url, webdav_username, webdav_password) = {
        let verge = Config::verge().await;
        let verge = verge.latest_arc();
        (
            verge.webdav_url.clone(),
            verge.webdav_username.clone(),
            verge.webdav_password.clone(),
        )
    };

    let file = AsyncHandler::spawn_blocking(move || std::fs::File::open(&target_path)).await??;
    let mut zip = zip::ZipArchive::new(file)?;
    zip.extract(app_home_dir()?)?;
    finalize_restored_verge_config(webdav_url, webdav_username, webdav_password).await?;
    Ok(())
}

/// Export local backup file to user selected destination
pub async fn export_local_backup(filename: String, destination: String) -> Result<()> {
    let backup_dir = local_backup_dir()?;
    let source_path = backup_dir.join(filename.as_str());
    if !source_path.exists() {
        return Err(anyhow!("Backup file not found: {}", filename));
    }

    let dest_path = PathBuf::from(destination.as_str());
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    fs::copy(&source_path, &dest_path)
        .await
        .map(|_| ())
        .map_err(|err| anyhow!("Failed to export backup file: {err:#?}"))?;
    Ok(())
}

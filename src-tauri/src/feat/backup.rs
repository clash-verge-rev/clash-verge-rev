use crate::{
    config::{Config, IClashTemp, IProfiles, IVerge},
    core::{backup, proxy_control::SystemProxyStateUnknown},
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

/// Reloads restored configs into memory while preserving WebDAV credentials.
async fn finalize_restored_verge_config(
    webdav_url: Option<String>,
    webdav_username: Option<String>,
    webdav_password: Option<String>,
) -> Result<()> {
    // A broken restored `verge.yaml` is a restore failure, not a reason to load defaults.
    let mut restored = help::read_yaml::<IVerge>(&verge_path()?).await?;
    restored.webdav_url = webdav_url;
    restored.webdav_username = webdav_username;
    restored.webdav_password = webdav_password;
    restored.save_file().await?;

    let restored_clash = IClashTemp::new().await;
    let clash_draft = Config::clash().await;
    clash_draft.edit_draft(|d| {
        *d = restored_clash.clone();
    });
    clash_draft.apply();

    let restored_profiles = IProfiles::new().await;
    let profiles_draft = Config::profiles().await;
    profiles_draft.edit_draft(|d| {
        *d = restored_profiles.clone();
    });
    profiles_draft.apply();

    let verge_draft = Config::verge().await;
    verge_draft.edit_draft(|d| {
        *d = restored.clone();
    });
    verge_draft.apply();

    // Run configuration side effects without rewriting the already-restored file.
    if let Err(err) = super::patch_verge(&restored, true).await {
        logging!(error, Type::Backup, "Failed to apply restored verge config: {err:#?}");
        // Propagate unknown proxy state; ordinary side-effect failures stay logged.
        if SystemProxyStateUnknown::is_in(&err) {
            return Err(err);
        }
    }
    Ok(())
}

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
        backup::WebDavClient::global().reset();
        return Err(err);
    }

    if let Err(err) = temp_file_path.remove_if_exists().await {
        logging!(warn, Type::Backup, "Failed to remove temp file: {err:#?}");
    }

    Ok(())
}

pub async fn list_wevdav_backup() -> Result<Vec<ListFile>> {
    backup::WebDavClient::global().list().await.map_err(|err| {
        logging!(error, Type::Backup, "Failed to list WebDAV backup files: {err:#?}");
        err
    })
}

pub async fn delete_webdav_backup(filename: String) -> Result<()> {
    backup::WebDavClient::global().delete(filename).await.map_err(|err| {
        logging!(error, Type::Backup, "Failed to delete WebDAV backup file: {err:#?}");
        err
    })
}

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

    let value = backup_storage_path.clone();
    let file = AsyncHandler::spawn_blocking(move || std::fs::File::open(&value)).await??;
    let mut zip = zip::ZipArchive::new(file)?;
    let _profile_write = crate::config::profiles::PROFILE_WRITE_LOCK.lock().await;
    zip.extract(app_home_dir()?)?;
    let res = finalize_restored_verge_config(webdav_url, webdav_username, webdav_password).await;
    let _ = backup_storage_path.remove_if_exists().await;
    res
}

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

pub async fn import_local_backup(source: String) -> Result<String> {
    let source_path = PathBuf::from(source.as_str());
    if !source_path.exists() {
        return Err(anyhow!("Backup file not found: {source}"));
    }
    if !source_path.is_file() {
        return Err(anyhow!("Backup path is not a file: {source}"));
    }

    let ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "zip" {
        return Err(anyhow!("Only .zip backup files are supported"));
    }

    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("Invalid backup file name"))?;

    let backup_dir = local_backup_dir()?;
    let target_path = backup_dir.join(file_name);

    if target_path == source_path {
        return Ok(file_name.to_string().into());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    if target_path.exists() {
        return Err(anyhow!("Backup file already exists: {file_name}"));
    }

    fs::copy(&source_path, &target_path)
        .await
        .map_err(|err| anyhow!("Failed to import backup file: {err:#?}"))?;

    Ok(file_name.to_string().into())
}

async fn move_file(from: PathBuf, to: PathBuf) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).await?;
    }

    match fs::rename(&from, &to).await {
        Ok(_) => Ok(()),
        Err(rename_err) => {
            // Rename can fail across filesystems; fall back to copy then remove.
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
    let _profile_write = crate::config::profiles::PROFILE_WRITE_LOCK.lock().await;
    zip.extract(app_home_dir()?)?;
    finalize_restored_verge_config(webdav_url, webdav_username, webdav_password).await?;
    Ok(())
}

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

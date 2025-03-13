use super::CmdResult;
use crate::{config::*, core, feat, wrap_err};
use reqwest_dav::list_cmd::ListFile;

/// 保存 WebDAV 配置
#[tauri::command]
pub async fn save_webdav_config(url: String, username: String, password: String) -> CmdResult<()> {
    let patch = IVerge {
        webdav_url: Some(url),
        webdav_username: Some(username),
        webdav_password: Some(password),
        ..IVerge::default()
    };
    Config::verge().draft().patch_config(patch.clone());
    Config::verge().apply();
    Config::verge()
        .data()
        .save_file()
        .map_err(|err| err.to_string())?;
    core::backup::WebDavClient::global().reset();
    Ok(())
}

/// 创建 WebDAV 备份并上传
#[tauri::command]
pub async fn create_webdav_backup() -> CmdResult<()> {
    wrap_err!(feat::create_backup_and_upload_webdav().await)
}

/// 列出 WebDAV 上的备份文件
#[tauri::command]
pub async fn list_webdav_backup() -> CmdResult<Vec<ListFile>> {
    wrap_err!(feat::list_wevdav_backup().await)
}

/// 删除 WebDAV 上的备份文件
#[tauri::command]
pub async fn delete_webdav_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::delete_webdav_backup(filename).await)
}

/// 从 WebDAV 恢复备份文件
#[tauri::command]
pub async fn restore_webdav_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::restore_webdav_backup(filename).await)
}

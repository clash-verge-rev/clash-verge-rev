use super::CmdResult;
use crate::{cmd::StringifyErr, config::*, core, feat};
use reqwest_dav::list_cmd::ListFile;
use smartstring::alias::String;

/// 保存 WebDAV 配置
#[tauri::command]
pub async fn save_webdav_config(url: String, username: String, password: String) -> CmdResult<()> {
    let patch = IVerge {
        webdav_url: Some(url),
        webdav_username: Some(username),
        webdav_password: Some(password),
        ..IVerge::default()
    };
    Config::verge().await.edit_draft(|e| e.patch_config(&patch));
    Config::verge().await.apply();

    // 分离数据获取和异步调用
    let verge_data = Config::verge().await.latest_arc();
    verge_data
        .save_file()
        .await
        .map_err(|err| err.to_string())?;
    core::backup::WebDavClient::global().reset();
    Ok(())
}

/// 创建 WebDAV 备份并上传
#[tauri::command]
pub async fn create_webdav_backup() -> CmdResult<()> {
    feat::create_backup_and_upload_webdav()
        .await
        .stringify_err()
}

/// 列出 WebDAV 上的备份文件
#[tauri::command]
pub async fn list_webdav_backup() -> CmdResult<Vec<ListFile>> {
    feat::list_wevdav_backup().await.stringify_err()
}

/// 删除 WebDAV 上的备份文件
#[tauri::command]
pub async fn delete_webdav_backup(filename: String) -> CmdResult<()> {
    feat::delete_webdav_backup(filename).await.stringify_err()
}

/// 从 WebDAV 恢复备份文件
#[tauri::command]
pub async fn restore_webdav_backup(filename: String) -> CmdResult<()> {
    feat::restore_webdav_backup(filename).await.stringify_err()
}

use super::CmdResult;
use crate::core::sysopt::Sysopt;
use crate::utils::resolve::ui::{self, UiReadyStage};
use crate::{
    cmd::StringifyErr as _,
    feat,
    utils::dirs::{self, PathBufExec as _},
};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::path::Path;
use tauri::{AppHandle, Manager as _};
use tokio::fs;
use tokio::io::AsyncWriteExt as _;

/// 打开应用程序所在目录
#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

/// 打开核心所在目录
#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

/// 打开日志目录
#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

/// 打开网页链接
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    open::that(url.as_str()).stringify_err()
}

// TODO 后续可以为前端提供接口，当前作为托盘菜单使用
/// 打开 Verge 最新日志
#[tauri::command]
pub async fn open_app_log() -> CmdResult<()> {
    open::that(dirs::app_latest_log().stringify_err()?).stringify_err()
}

// TODO 后续可以为前端提供接口，当前作为托盘菜单使用
/// 打开 Clash 最新日志
#[tauri::command]
pub async fn open_core_log() -> CmdResult<()> {
    open::that(dirs::clash_latest_log().stringify_err()?).stringify_err()
}

/// 打开/关闭开发者工具
#[tauri::command]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

/// 退出应用
#[tauri::command]
pub async fn exit_app() {
    feat::quit().await;
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

/// 获取便携版标识
#[tauri::command]
pub fn get_portable_flag() -> bool {
    *dirs::PORTABLE_FLAG.get().unwrap_or(&false)
}

/// 获取应用目录
#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

/// 获取当前自启动状态
#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    Sysopt::global().get_launch_status().stringify_err()
}

/// 下载图标缓存
#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    let icon_cache_dir = dirs::app_home_dir().stringify_err()?.join("icons").join("cache");
    let icon_path = icon_cache_dir.join(name.as_str());

    if icon_path.exists() {
        return Ok(icon_path.to_string_lossy().into());
    }

    if !icon_cache_dir.exists() {
        let _ = fs::create_dir_all(&icon_cache_dir).await;
    }

    let temp_path = icon_cache_dir.join(format!("{}.downloading", name.as_str()));

    let response = reqwest::get(url.as_str()).await.stringify_err()?;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_image = content_type.starts_with("image/");

    let content = response.bytes().await.stringify_err()?;

    let is_html = content.len() > 15
        && (content.starts_with(b"<!DOCTYPE html") || content.starts_with(b"<html") || content.starts_with(b"<?xml"));

    if is_image && !is_html {
        {
            let mut file = match fs::File::create(&temp_path).await {
                Ok(file) => file,
                Err(_) => {
                    if icon_path.exists() {
                        return Ok(icon_path.to_string_lossy().into());
                    }
                    return Err("Failed to create temporary file".into());
                }
            };
            file.write_all(content.as_ref()).await.stringify_err()?;
            file.flush().await.stringify_err()?;
        }

        if !icon_path.exists() {
            match fs::rename(&temp_path, &icon_path).await {
                Ok(_) => {}
                Err(_) => {
                    let _ = temp_path.remove_if_exists().await;
                    if icon_path.exists() {
                        return Ok(icon_path.to_string_lossy().into());
                    }
                }
            }
        } else {
            let _ = temp_path.remove_if_exists().await;
        }

        Ok(icon_path.to_string_lossy().into())
    } else {
        let _ = temp_path.remove_if_exists().await;
        Err(format!("下载的内容不是有效图片: {}", url.as_str()).into())
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct IconInfo {
    name: String,
    previous_t: String,
    current_t: String,
}

/// 复制图标文件
#[tauri::command]
pub async fn copy_icon_file(path: String, icon_info: IconInfo) -> CmdResult<String> {
    let file_path = Path::new(path.as_str());

    let icon_dir = dirs::app_home_dir().stringify_err()?.join("icons");
    if !icon_dir.exists() {
        let _ = fs::create_dir_all(&icon_dir).await;
    }
    let ext: String = match file_path.extension() {
        Some(e) => e.to_string_lossy().into(),
        None => "ico".into(),
    };

    let dest_path = icon_dir.join(format!(
        "{0}-{1}.{ext}",
        icon_info.name.as_str(),
        icon_info.current_t.as_str()
    ));
    if file_path.exists() {
        if icon_info.previous_t.trim() != "" {
            icon_dir
                .join(format!(
                    "{0}-{1}.png",
                    icon_info.name.as_str(),
                    icon_info.previous_t.as_str()
                ))
                .remove_if_exists()
                .await
                .unwrap_or_default();
            icon_dir
                .join(format!(
                    "{0}-{1}.ico",
                    icon_info.name.as_str(),
                    icon_info.previous_t.as_str()
                ))
                .remove_if_exists()
                .await
                .unwrap_or_default();
        }
        logging!(
            info,
            Type::Cmd,
            "Copying icon file path: {:?} -> file dist: {:?}",
            path,
            dest_path
        );
        match fs::copy(file_path, &dest_path).await {
            Ok(_) => Ok(dest_path.to_string_lossy().into()),
            Err(err) => Err(err.to_string().into()),
        }
    } else {
        Err("file not found".into())
    }
}

/// 通知UI已准备就绪
#[tauri::command]
pub fn notify_ui_ready() {
    logging!(info, Type::Cmd, "前端UI已准备就绪");
    ui::mark_ui_ready();
}

/// UI加载阶段
#[tauri::command]
pub fn update_ui_stage(stage: UiReadyStage) {
    logging!(info, Type::Cmd, "UI加载阶段更新: {:?}", &stage);
    ui::update_ui_ready_stage(stage);
}

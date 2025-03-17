use super::CmdResult;
use crate::{feat, utils::dirs, wrap_err};
use tauri::Manager;

/// 打开应用程序所在目录
#[tauri::command]
pub fn open_app_dir() -> CmdResult<()> {
    let app_dir = wrap_err!(dirs::app_home_dir())?;
    wrap_err!(open::that(app_dir))
}

/// 打开核心所在目录
#[tauri::command]
pub fn open_core_dir() -> CmdResult<()> {
    let core_dir = wrap_err!(tauri::utils::platform::current_exe())?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    wrap_err!(open::that(core_dir))
}

/// 打开日志目录
#[tauri::command]
pub fn open_logs_dir() -> CmdResult<()> {
    let log_dir = wrap_err!(dirs::app_logs_dir())?;
    wrap_err!(open::that(log_dir))
}

/// 打开网页链接
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    wrap_err!(open::that(url))
}

/// 打开/关闭开发者工具
#[tauri::command]
pub fn open_devtools(app_handle: tauri::AppHandle) {
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
pub fn exit_app() {
    feat::quit(Some(0));
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app();
    Ok(())
}

/// 获取便携版标识
#[tauri::command]
pub fn get_portable_flag() -> CmdResult<bool> {
    Ok(*dirs::PORTABLE_FLAG.get().unwrap_or(&false))
}

/// 获取应用目录
#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = wrap_err!(dirs::app_home_dir())?
        .to_string_lossy()
        .to_string();
    Ok(app_home_dir)
}

/// 获取当前自启动状态
#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    use crate::core::sysopt::Sysopt;
    wrap_err!(Sysopt::global().get_launch_status())
}

/// 下载图标缓存
#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    let icon_cache_dir = wrap_err!(dirs::app_home_dir())?.join("icons").join("cache");
    let icon_path = icon_cache_dir.join(&name);

    // 如果文件已存在，直接返回路径
    if icon_path.exists() {
        return Ok(icon_path.to_string_lossy().to_string());
    }

    // 确保缓存目录存在
    if !icon_cache_dir.exists() {
        let _ = std::fs::create_dir_all(&icon_cache_dir);
    }

    // 使用临时文件名来下载
    let temp_path = icon_cache_dir.join(format!("{}.downloading", &name));

    // 下载文件到临时位置
    let response = wrap_err!(reqwest::get(&url).await)?;

    // 检查内容类型是否为图片
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_image = content_type.starts_with("image/");

    // 获取响应内容
    let content = wrap_err!(response.bytes().await)?;

    // 检查内容是否为HTML (针对CDN错误页面)
    let is_html = content.len() > 15
        && (content.starts_with(b"<!DOCTYPE html")
            || content.starts_with(b"<html")
            || content.starts_with(b"<?xml"));

    // 只有当内容确实是图片时才保存
    if is_image && !is_html {
        {
            let mut file = match std::fs::File::create(&temp_path) {
                Ok(file) => file,
                Err(_) => {
                    if icon_path.exists() {
                        return Ok(icon_path.to_string_lossy().to_string());
                    } else {
                        return Err("Failed to create temporary file".into());
                    }
                }
            };

            wrap_err!(std::io::copy(&mut content.as_ref(), &mut file))?;
        }

        // 再次检查目标文件是否已存在，避免重命名覆盖其他线程已完成的文件
        if !icon_path.exists() {
            match std::fs::rename(&temp_path, &icon_path) {
                Ok(_) => {}
                Err(_) => {
                    let _ = std::fs::remove_file(&temp_path);
                    if icon_path.exists() {
                        return Ok(icon_path.to_string_lossy().to_string());
                    }
                }
            }
        } else {
            let _ = std::fs::remove_file(&temp_path);
        }

        Ok(icon_path.to_string_lossy().to_string())
    } else {
        let _ = std::fs::remove_file(&temp_path);
        Err(format!("下载的内容不是有效图片: {}", url))
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
pub fn copy_icon_file(path: String, icon_info: IconInfo) -> CmdResult<String> {
    use std::{fs, path::Path};

    let file_path = Path::new(&path);

    let icon_dir = wrap_err!(dirs::app_home_dir())?.join("icons");
    if !icon_dir.exists() {
        let _ = fs::create_dir_all(&icon_dir);
    }
    let ext = match file_path.extension() {
        Some(e) => e.to_string_lossy().to_string(),
        None => "ico".to_string(),
    };

    let dest_path = icon_dir.join(format!(
        "{0}-{1}.{ext}",
        icon_info.name, icon_info.current_t
    ));
    if file_path.exists() {
        if icon_info.previous_t.trim() != "" {
            fs::remove_file(
                icon_dir.join(format!("{0}-{1}.png", icon_info.name, icon_info.previous_t)),
            )
            .unwrap_or_default();
            fs::remove_file(
                icon_dir.join(format!("{0}-{1}.ico", icon_info.name, icon_info.previous_t)),
            )
            .unwrap_or_default();
        }

        match fs::copy(file_path, &dest_path) {
            Ok(_) => Ok(dest_path.to_string_lossy().to_string()),
            Err(err) => Err(err.to_string()),
        }
    } else {
        Err("file not found".to_string())
    }
}

use serde_yaml::Mapping;
use sysproxy::{Autoproxy, Sysproxy};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::{
    core::{
        manager, sysopt,
        tray::{Tray, TRAY_ID},
        CoreManager,
    },
    ret_err,
    utils::{dirs, resolve},
    wrap_err,
};

use super::CmdResult;

#[tauri::command]
pub fn get_portable_flag() -> CmdResult<bool> {
    Ok(*dirs::PORTABLE_FLAG.get().unwrap_or(&false))
}

#[tauri::command]
pub async fn check_port_available(port: u16) -> CmdResult<bool> {
    Ok(port_scanner::local_port_available(port))
}

/// restart the sidecar
#[tauri::command]
pub async fn restart_sidecar() -> CmdResult {
    wrap_err!(CoreManager::global().run_core().await)
}

#[tauri::command]
pub fn grant_permission(_core: String) -> CmdResult {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    return wrap_err!(manager::grant_permission(_core));

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("Unsupported target".into());
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> CmdResult<Mapping> {
    let current = wrap_err!(Sysproxy::get_system_proxy())?;
    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert(
        "server".into(),
        format!("{}:{}", current.host, current.port).into(),
    );
    map.insert("bypass".into(), current.bypass.replace("@as [", "").into());

    Ok(map)
}

#[tauri::command]
pub fn get_default_bypass() -> CmdResult<String> {
    Ok(sysopt::get_default_bypass())
}

/// get the system proxy
#[tauri::command]
pub fn get_auto_proxy() -> CmdResult<Mapping> {
    let current = wrap_err!(Autoproxy::get_auto_proxy())?;

    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert("url".into(), current.url.into());

    Ok(map)
}

#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = wrap_err!(dirs::app_home_dir())?
        .to_string_lossy()
        .to_string();
    Ok(app_home_dir)
}

#[tauri::command]
pub fn open_app_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let app_dir = wrap_err!(dirs::app_home_dir())?;
    wrap_err!(app_handle
        .opener()
        .open_path(app_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_core_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let core_dir = wrap_err!(tauri::utils::platform::current_exe())?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    wrap_err!(app_handle
        .opener()
        .open_path(core_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_logs_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let log_dir = wrap_err!(dirs::app_logs_dir())?;
    wrap_err!(app_handle
        .opener()
        .open_path(log_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_web_url(app_handle: tauri::AppHandle, url: String) -> CmdResult<()> {
    wrap_err!(app_handle.opener().open_url(url, None::<&str>))
}

#[tauri::command]
pub async fn invoke_uwp_tool() -> CmdResult {
    #[cfg(target_os = "windows")]
    {
        use super::*;
        use crate::core::win_uwp;
        return wrap_err!(win_uwp::invoke_uwptools().await);
    }
    Ok(())
}

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

#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    let icon_cache_dir = wrap_err!(dirs::app_home_dir())?.join("icons").join("cache");
    let icon_path = icon_cache_dir.join(name);
    if !icon_cache_dir.exists() {
        let _ = std::fs::create_dir_all(&icon_cache_dir);
    }
    if !icon_path.exists() {
        let response = wrap_err!(reqwest::get(url).await)?;

        let mut file = wrap_err!(std::fs::File::create(&icon_path))?;

        let content = wrap_err!(response.bytes().await)?;
        wrap_err!(std::io::copy(&mut content.as_ref(), &mut file))?;
    }
    Ok(icon_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_icon_file(path: String, name: String) -> CmdResult<String> {
    let file_path = std::path::Path::new(&path);
    let icon_dir = wrap_err!(dirs::app_home_dir())?.join("icons");
    if !icon_dir.exists() {
        let _ = std::fs::create_dir_all(&icon_dir);
    }
    let ext = match file_path.extension() {
        Some(e) => e.to_string_lossy().to_string(),
        None => "ico".to_string(),
    };

    let png_dest_path = icon_dir.join(format!("{name}.png"));
    let ico_dest_path = icon_dir.join(format!("{name}.ico"));
    let dest_path = icon_dir.join(format!("{name}.{ext}"));
    if file_path.exists() {
        std::fs::remove_file(png_dest_path).unwrap_or_default();
        std::fs::remove_file(ico_dest_path).unwrap_or_default();
        match std::fs::copy(file_path, &dest_path) {
            Ok(_) => Ok(dest_path.to_string_lossy().to_string()),
            Err(err) => Err(err.to_string()),
        }
    } else {
        ret_err!("file not found");
    }
}

#[tauri::command]
pub async fn set_tray_visible(app_handle: tauri::AppHandle, visible: bool) -> CmdResult {
    wrap_err!(Tray::set_tray_visible(&app_handle, visible))
}

#[tauri::command]
pub fn is_wayland() -> CmdResult<bool> {
    if cfg!(target_os = "linux") {
        let session_type = std::env::var("XDG_SESSION_TYPE")
            .unwrap_or("".to_string())
            .to_lowercase();
        Ok(session_type == "wayland")
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn restart_app(app_handle: tauri::AppHandle) {
    let _ = resolve::save_window_size_position(&app_handle, false);
    let _ = CoreManager::global().stop_core().await;
    app_handle.remove_tray_by_id(TRAY_ID);
    app_handle.restart();
}

#[tauri::command]
pub async fn exit_app(app_handle: tauri::AppHandle) {
    let _ = resolve::save_window_size_position(&app_handle, true);
    resolve::resolve_reset().await;
    app_handle.exit(0);
}

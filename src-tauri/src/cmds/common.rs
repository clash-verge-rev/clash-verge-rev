use std::io;

use network_interface::NetworkInterfaceConfig;
use serde::Serialize;
use serde_yaml::Mapping;
use sysproxy::{Autoproxy, Sysproxy};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::{
    any_err,
    core::{CoreManager, handle, sysopt, tray::Tray},
    error::{AppError, AppResult},
    feat,
    utils::{self, dirs, help, resolve},
};

#[derive(Serialize, Debug)]
pub struct NetInfo {
    name: String,
    ipv4: Option<String>,
    ipv6: Option<String>,
}

#[tauri::command]
pub fn get_portable_flag() -> AppResult<bool> {
    Ok(*dirs::PORTABLE_FLAG.get().unwrap_or(&false))
}

#[tauri::command]
pub async fn check_port_available(port: u16) -> AppResult<bool> {
    Ok(help::local_port_available(port))
}

/// restart the sidecar
#[tauri::command]
pub async fn restart_sidecar() -> AppResult<()> {
    CoreManager::global().run_core().await
}

#[tauri::command]
pub fn grant_permission(_core: String) -> AppResult<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use crate::core::manager;
        manager::grant_permission(_core)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Err(any_err!("Unsupported target"))
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> AppResult<Mapping> {
    let current = Sysproxy::get_system_proxy()?;
    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert("server".into(), format!("{}:{}", current.host, current.port).into());
    map.insert("bypass".into(), current.bypass.replace("@as [", "").into());
    Ok(map)
}

#[tauri::command]
pub fn get_default_bypass() -> AppResult<String> {
    Ok(sysopt::get_default_bypass())
}

/// get the system proxy
#[tauri::command]
pub fn get_auto_proxy() -> AppResult<Mapping> {
    let current = Autoproxy::get_auto_proxy()?;
    let res = Mapping::from_iter([
        ("enable".into(), current.enable.into()),
        ("url".into(), current.url.into()),
    ]);
    Ok(res)
}

#[tauri::command]
pub fn get_app_dir() -> AppResult<String> {
    let app_home_dir = dirs::app_home_dir()?.to_string_lossy().to_string();
    Ok(app_home_dir)
}

#[tauri::command]
pub fn open_app_dir(app_handle: tauri::AppHandle) -> AppResult<()> {
    let app_dir = dirs::app_home_dir()?;
    app_handle.opener().open_path(app_dir.to_string_lossy(), None::<&str>)?;
    Ok(())
}

#[tauri::command]
pub fn open_core_dir(app_handle: tauri::AppHandle) -> AppResult<()> {
    let core_dir = tauri::utils::platform::current_exe()?;
    let core_dir = core_dir.parent().ok_or(any_err!("failed to get core dir"))?;
    app_handle
        .opener()
        .open_path(core_dir.to_string_lossy(), None::<&str>)?;
    Ok(())
}

#[tauri::command]
pub fn open_logs_dir(app_handle: tauri::AppHandle) -> AppResult<()> {
    let log_dir = dirs::app_logs_dir()?;
    app_handle.opener().open_path(log_dir.to_string_lossy(), None::<&str>)?;
    Ok(())
}

#[tauri::command]
pub fn open_web_url(app_handle: tauri::AppHandle, url: String) -> AppResult<()> {
    app_handle.opener().open_url(url, None::<&str>)?;
    Ok(())
}

#[tauri::command]
pub async fn invoke_uwp_tool() -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        use crate::core::win_uwp;
        win_uwp::invoke_uwptools().await?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_devtools(app_handle: tauri::AppHandle) -> AppResult<()> {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_clash_env() -> AppResult<()> {
    feat::copy_clash_env(handle::Handle::app_handle());
    Ok(())
}

#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> AppResult<String> {
    let icon_cache_dir = dirs::app_home_dir()?.join("icons").join("cache");
    let icon_path = icon_cache_dir.join(name);
    if !icon_cache_dir.exists() {
        let _ = std::fs::create_dir_all(&icon_cache_dir);
    }
    if !icon_path.exists() {
        let response = reqwest::get(url).await?;

        let mut file = std::fs::File::create(&icon_path)?;

        let content = response.bytes().await?;
        std::io::copy(&mut content.as_ref(), &mut file)?;
    }
    Ok(icon_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_icon_file(path: String, name: String) -> AppResult<String> {
    let file_path = std::path::Path::new(&path);
    let icon_dir = dirs::app_home_dir()?.join("icons");
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
        std::fs::copy(file_path, &dest_path)?;
        Ok(dest_path.to_string_lossy().to_string())
    } else {
        Err(AppError::Io(io::Error::new(io::ErrorKind::NotFound, "file not found")))
    }
}

#[tauri::command]
pub async fn set_tray_visible(app_handle: tauri::AppHandle, visible: bool) -> AppResult<()> {
    Tray::set_tray_visible(&app_handle, visible)
}

#[tauri::command]
pub fn is_wayland() -> AppResult<bool> {
    Ok(utils::unix_helper::is_wayland())
}

#[tauri::command]
pub fn get_net_info() -> AppResult<Vec<NetInfo>> {
    let mut net_list = Vec::new();
    let network_interfaces = network_interface::NetworkInterface::show()?;
    for network in network_interfaces.into_iter() {
        let mut net_info = NetInfo {
            name: network.name,
            ipv4: None,
            ipv6: None,
        };
        if !network.addr.is_empty() {
            network.addr.iter().for_each(|addr| match addr {
                network_interface::Addr::V4(addr_v4) => net_info.ipv4 = Some(addr_v4.ip.to_string()),
                network_interface::Addr::V6(addr_v6) => net_info.ipv6 = Some(addr_v6.ip.to_string()),
            });
            net_list.push(net_info);
        }
    }
    net_list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(net_list)
}

#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    utils::server::shutdown_embedded_server();
    let _ = resolve::save_window_size_position(&app_handle);
    tauri::async_runtime::block_on(async {
        resolve::resolve_reset().await;
    });
    app_handle.restart();
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    utils::server::shutdown_embedded_server();
    let _ = resolve::save_window_size_position(&app_handle);
    tauri::async_runtime::block_on(async {
        resolve::resolve_reset().await;
    });
    app_handle.exit(0);
}

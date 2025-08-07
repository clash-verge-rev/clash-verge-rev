use network_interface::NetworkInterfaceConfig;
use serde::Serialize;
use serde_yaml::Mapping;
use sysproxy::{Autoproxy, Sysproxy};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::{
    core::{CoreManager, handle, sysopt, tray::Tray},
    feat, ret_err,
    utils::{self, dirs, help, resolve},
    wrap_err,
};

use super::CmdResult;

#[derive(Serialize, Debug)]
pub struct NetInfo {
    name: String,
    ipv4: Option<String>,
    ipv6: Option<String>,
}

#[tauri::command]
pub fn get_portable_flag() -> CmdResult<bool> {
    Ok(*dirs::PORTABLE_FLAG.get().unwrap_or(&false))
}

#[tauri::command]
pub async fn check_port_available(port: u16) -> CmdResult<bool> {
    Ok(help::local_port_available(port))
}

/// restart the sidecar
#[tauri::command]
pub async fn restart_sidecar() -> CmdResult {
    wrap_err!(CoreManager::global().run_core().await)
}

#[tauri::command]
pub fn grant_permission(_core: String) -> CmdResult {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use crate::core::manager;
        wrap_err!(manager::grant_permission(_core))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Err("Unsupported target".into())
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> CmdResult<Mapping> {
    let current = wrap_err!(Sysproxy::get_system_proxy())?;
    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert("server".into(), format!("{}:{}", current.host, current.port).into());
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
    let app_home_dir = wrap_err!(dirs::app_home_dir())?.to_string_lossy().to_string();
    Ok(app_home_dir)
}

#[tauri::command]
pub fn open_app_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let app_dir = wrap_err!(dirs::app_home_dir())?;
    wrap_err!(app_handle.opener().open_path(app_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_core_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let core_dir = wrap_err!(tauri::utils::platform::current_exe())?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    wrap_err!(app_handle.opener().open_path(core_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_logs_dir(app_handle: tauri::AppHandle) -> CmdResult<()> {
    let log_dir = wrap_err!(dirs::app_logs_dir())?;
    wrap_err!(app_handle.opener().open_path(log_dir.to_string_lossy(), None::<&str>))
}

#[tauri::command]
pub fn open_web_url(app_handle: tauri::AppHandle, url: String) -> CmdResult<()> {
    wrap_err!(app_handle.opener().open_url(url, None::<&str>))
}

#[tauri::command]
pub async fn invoke_uwp_tool() -> CmdResult {
    #[cfg(target_os = "windows")]
    {
        use crate::core::win_uwp;
        wrap_err!(win_uwp::invoke_uwptools().await)?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_devtools(app_handle: tauri::AppHandle) -> CmdResult {
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
pub fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env(handle::Handle::get_app_handle());
    Ok(())
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
pub fn get_net_info() -> CmdResult<Vec<NetInfo>> {
    let mut net_list = Vec::new();
    let network_interfaces = wrap_err!(network_interface::NetworkInterface::show())?;
    for network in network_interfaces.iter() {
        let mut net_info = NetInfo {
            name: network.name.clone(),
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

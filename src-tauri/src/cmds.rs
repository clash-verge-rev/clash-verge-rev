use crate::{
    config::*,
    core::*,
    feat,
    utils::{dirs, help},
};
use crate::{log_err, ret_err, wrap_err};
use anyhow::{Context, Result};
use network_interface::NetworkInterface;
use serde_yaml::Mapping;
use std::collections::HashMap;
use sysproxy::{Autoproxy, Sysproxy};
type CmdResult<T = ()> = Result<T, String>;
use reqwest_dav::list_cmd::ListFile;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::fs;

#[tauri::command]
pub fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env();
    Ok(())
}

#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    let _ = tray::Tray::global().update_menu();
    Ok(Config::profiles().data().clone())
}

#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(CoreManager::global().update_config().await)?;
    log_err!(tray::Tray::global().update_tooltip());
    handle::Handle::refresh_clash();
    Ok(())
}

#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

#[tauri::command]
pub async fn reorder_profile(active_id: String, over_id: String) -> CmdResult {
    wrap_err!(Config::profiles().data().reorder(active_id, over_id))
}

#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
    let item = wrap_err!(PrfItem::from(item, file_data).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
}

#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
    wrap_err!(feat::update_profile(index, option).await)
}

#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    let should_update = wrap_err!({ Config::profiles().data().delete_item(index) })?;
    if should_update {
        wrap_err!(CoreManager::global().update_config().await)?;
        handle::Handle::refresh_clash();
    }
    Ok(())
}

/// 修改profiles的配置
#[tauri::command]
pub async fn patch_profiles_config(
    profiles: IProfiles
) -> CmdResult {
    println!("[cmd配置patch] 开始修改配置文件");
    
    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().latest().current.clone();
    println!("[cmd配置patch] 当前配置: {:?}", current_profile);
    
    // 更新profiles配置
    println!("[cmd配置patch] 正在更新配置草稿");
    wrap_err!({ Config::profiles().draft().patch_config(profiles) })?;
    
    // 更新配置并进行验证
    match CoreManager::global().update_config().await {
        Ok(_) => {
            println!("[cmd配置patch] 配置更新成功");
            handle::Handle::refresh_clash();
            let _ = tray::Tray::global().update_tooltip();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            
            // 发送成功通知
            handle::Handle::notice_message("operation_success", "配置patch成功");
            Ok(())
        }
        Err(err) => {
            println!("[cmd配置patch] 更新配置失败: {}", err);
            Config::profiles().discard();
            println!("[cmd配置patch] 错误详情: {}", err);
            
            // 如果验证失败，恢复到之前的配置
            if let Some(prev_profile) = current_profile {
                println!("[cmd配置patch] 尝试恢复到之前的配置: {}", prev_profile);
                let restore_profiles = IProfiles {
                    current: Some(prev_profile),
                    items: None,
                };
                // 静默恢复，不触发验证
                wrap_err!({ Config::profiles().draft().patch_config(restore_profiles) })?;
                Config::profiles().apply();
                wrap_err!(Config::profiles().data().save_file())?;
                println!("[cmd配置patch] 成功恢复到之前的配置");
            }

            Err(err.to_string())
        }
    }
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(
    _app_handle: tauri::AppHandle,
    profile_index: String
) -> CmdResult {
    let profiles = IProfiles{current: Some(profile_index), items: None};
    patch_profiles_config(profiles).await
}

/// 修改某个profile item的
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    wrap_err!(Config::profiles().data().patch_item(index, profile))?;
    Ok(())
}

#[tauri::command]
pub fn view_profile(app_handle: tauri::AppHandle, index: String) -> CmdResult {
    let file = {
        wrap_err!(Config::profiles().latest().get_item(&index))?
            .file
            .clone()
            .ok_or("the file field is null")
    }?;

    let path = wrap_err!(dirs::app_profiles_dir())?.join(file);
    if !path.exists() {
        ret_err!("the file not found");
    }

    wrap_err!(help::open_file(app_handle, path))
}

#[tauri::command]
pub fn read_profile_file(index: String) -> CmdResult<String> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = wrap_err!(profiles.get_item(&index))?;
    let data = wrap_err!(item.read_file())?;
    Ok(data)
}
/// 保存profiles的配置
#[tauri::command]
pub async fn save_profile_file(index: String, file_data: Option<String>) -> CmdResult {
    if file_data.is_none() {
        return Ok(());
    }

    // 在异步操作前完成所有文件操作
    let (file_path, original_content) = {
        let profiles = Config::profiles();
        let profiles_guard = profiles.latest();
        let item = wrap_err!(profiles_guard.get_item(&index))?;
        let content = wrap_err!(item.read_file())?;
        let path = item.file.clone().ok_or("file field is null")?;
        let profiles_dir = wrap_err!(dirs::app_profiles_dir())?;
        (profiles_dir.join(path), content)
    };

    // 保存新的配置文件
    wrap_err!(fs::write(&file_path, file_data.clone().unwrap()))?;
    
    // 直接验证保存的配置文件
    let clash_core = Config::verge().latest().clash_core.clone().unwrap_or("verge-mihomo".into());
    let test_dir = wrap_err!(dirs::app_home_dir())?.join("test");
    let test_dir = test_dir.to_string_lossy();
    let file_path_str = file_path.to_string_lossy();
    
    println!("[cmd配置save] 开始验证配置文件: {}", file_path_str);
    
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let output = wrap_err!(app_handle
        .shell()
        .sidecar(clash_core)
        .map_err(|e| e.to_string())?
        .args(["-t", "-d", test_dir.as_ref(), "-f", file_path_str.as_ref()])
        .output()
        .await)?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let error_keywords = ["FATA", "fatal", "Parse config error", "level=fatal"];
    let has_error = !output.status.success() || error_keywords.iter().any(|&kw| stderr.contains(kw));

    if has_error {
        println!("[cmd配置save] 编辑验证失败 {}", stderr);
        // 恢复原始配置文件
        wrap_err!(fs::write(&file_path, original_content))?;
        // 发送错误通知
        handle::Handle::notice_message("config_validate::error", &*stderr);
        return Err(format!("cmd配置save失败 {}", stderr));
    }

    println!("[cmd配置save] 验证成功");
    handle::Handle::notice_message("operation_success", "配置更新成功");
    Ok(())
}

#[tauri::command]
pub fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().latest().get_client_info())
}

#[tauri::command]
pub fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(Config::runtime().latest().config.clone())
}

#[tauri::command]
pub fn get_runtime_yaml() -> CmdResult<String> {
    let runtime = Config::runtime();
    let runtime = runtime.latest();
    let config = runtime.config.as_ref();
    wrap_err!(config
        .ok_or(anyhow::anyhow!("failed to parse config to yaml file"))
        .and_then(
            |config| serde_yaml::to_string(config).context("failed to convert config to yaml")
        ))
}

#[tauri::command]
pub fn get_runtime_exists() -> CmdResult<Vec<String>> {
    Ok(Config::runtime().latest().exists_keys.clone())
}

#[tauri::command]
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
    Ok(Config::runtime().latest().chain_logs.clone())
}

#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    Ok(feat::change_clash_mode(payload))
}


#[tauri::command]
pub fn get_verge_config() -> CmdResult<IVergeResponse> {
    let verge = Config::verge();
    let verge_data = verge.data().clone();
    Ok(IVergeResponse::from(verge_data))
}

#[tauri::command]
pub async fn patch_verge_config(payload: IVerge) -> CmdResult {
    wrap_err!(feat::patch_verge(payload).await)
}

#[tauri::command]
pub async fn change_clash_core(clash_core: Option<String>) -> CmdResult {
    wrap_err!(CoreManager::global().change_core(clash_core).await)
}

/// restart the sidecar
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    wrap_err!(CoreManager::global().restart_core().await)
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
    map.insert("bypass".into(), current.bypass.into());

    Ok(map)
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
pub fn open_app_dir() -> CmdResult<()> {
    let app_dir = wrap_err!(dirs::app_home_dir())?;
    wrap_err!(open::that(app_dir))
}

#[tauri::command]
pub fn open_core_dir() -> CmdResult<()> {
    let core_dir = wrap_err!(tauri::utils::platform::current_exe())?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    wrap_err!(open::that(core_dir))
}

#[tauri::command]
pub fn open_logs_dir() -> CmdResult<()> {
    let log_dir = wrap_err!(dirs::app_logs_dir())?;
    wrap_err!(open::that(log_dir))
}

#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    wrap_err!(open::that(url))
}

#[cfg(windows)]
pub mod uwp {
    use super::*;
    use crate::core::win_uwp;

    #[tauri::command]
    pub async fn invoke_uwp_tool() -> CmdResult {
        wrap_err!(win_uwp::invoke_uwptools().await)
    }
}

#[tauri::command]
pub async fn clash_api_get_proxy_delay(
    name: String,
    url: Option<String>,
    timeout: i32,
) -> CmdResult<clash_api::DelayRes> {
    match clash_api::get_proxy_delay(name, url, timeout).await {
        Ok(res) => Ok(res),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn get_portable_flag() -> CmdResult<bool> {
    Ok(*dirs::PORTABLE_FLAG.get().unwrap_or(&false))
}

#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    Ok(feat::test_delay(url).await.unwrap_or(10000u32))
}

#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = wrap_err!(dirs::app_home_dir())?
        .to_string_lossy()
        .to_string();
    Ok(app_home_dir)
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
        Err("file not found".to_string())
    }
}

#[tauri::command]
pub fn get_network_interfaces() -> Vec<String> {
    use sysinfo::Networks;
    let mut result = Vec::new();
    let networks = Networks::new_with_refreshed_list();
    for (interface_name, _) in &networks {
        result.push(interface_name.clone());
    }
    result
}

#[tauri::command]
pub fn get_network_interfaces_info() -> CmdResult<Vec<NetworkInterface>> {
    use network_interface::NetworkInterface;
    use network_interface::NetworkInterfaceConfig;

    let names = get_network_interfaces();
    let interfaces = wrap_err!(NetworkInterface::show())?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface);
        }
    }

    Ok(result)
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
pub fn exit_app() {
    feat::quit(Some(0));
}

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
    backup::WebDavClient::global().reset();
    Ok(())
}

#[tauri::command]
pub async fn create_webdav_backup() -> CmdResult<()> {
    wrap_err!(feat::create_backup_and_upload_webdav().await)
}

#[tauri::command]
pub async fn list_webdav_backup() -> CmdResult<Vec<ListFile>> {
    wrap_err!(feat::list_wevdav_backup().await)
}

#[tauri::command]
pub async fn delete_webdav_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::delete_webdav_backup(filename).await)
}

#[tauri::command]
pub async fn restore_webdav_backup(filename: String) -> CmdResult<()> {
    wrap_err!(feat::restore_webdav_backup(filename).await)
}

#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app();
    Ok(())
}

#[cfg(not(windows))]
pub mod uwp {
    use super::*;

    #[tauri::command]
    pub async fn invoke_uwp_tool() -> CmdResult {
        Ok(())
    }
}

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
    match CoreManager::global().update_config().await {
        Ok((true, _)) => {
            println!("[enhance_profiles] 配置更新成功");
            log_err!(tray::Tray::global().update_tooltip());
            handle::Handle::refresh_clash();
            Ok(())
        }
        Ok((false, error_msg)) => {
            println!("[enhance_profiles] 配置验证失败: {}", error_msg);
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(())
        }
        Err(e) => {
            println!("[enhance_profiles] 更新过程发生错误: {}", e);
            handle::Handle::notice_message("config_validate::process_terminated", &e.to_string());
            Ok(())
        }
    }
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
) -> CmdResult<bool> {
    println!("[cmd配置patch] 开始修改配置文件");
    
    // 保存当前配置，以便在验证失败时恢复
    let current_profile = Config::profiles().latest().current.clone();
    println!("[cmd配置patch] 当前配置: {:?}", current_profile);
    
    // 更新profiles配置
    println!("[cmd配置patch] 正在更新配置草稿");
    wrap_err!({ Config::profiles().draft().patch_config(profiles) })?;
    
    // 更新配置并进行验证
    match CoreManager::global().update_config().await {
        Ok((true, _)) => {
            println!("[cmd配置patch] 配置更新成功");
            handle::Handle::refresh_clash();
            let _ = tray::Tray::global().update_tooltip();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            Ok(true)
        }
        Ok((false, error_msg)) => {
            println!("[cmd配置patch] 配置验证失败: {}", error_msg);
            Config::profiles().discard();
            
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

            // 发送验证错误通知
            handle::Handle::notice_message("config_validate::error", &error_msg);
            Ok(false)
        }
        Err(e) => {
            println!("[cmd配置patch] 更新过程发生错误: {}", e);
            Config::profiles().discard();
            handle::Handle::notice_message("config_validate::boot_error", &e.to_string());
            Ok(false)
        }
    }
}

/// 根据profile name修改profiles
#[tauri::command]
pub async fn patch_profiles_config_by_profile_index(
    _app_handle: tauri::AppHandle,
    profile_index: String
) -> CmdResult<bool> {
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
    
    let file_path_str = file_path.to_string_lossy();
    println!("[cmd配置save] 开始验证配置文件: {}", file_path_str);
    
    // 验证配置文件
    match CoreManager::global().validate_config_file(&file_path_str).await {
        Ok((true, _)) => {
            println!("[cmd配置save] 验证成功");
            Ok(())
        }
        Ok((false, error_msg)) => {
            println!("[cmd配置save] 验证失败: {}", error_msg);
            // 恢复原始配置文件
            wrap_err!(fs::write(&file_path, original_content))?;
            
            // 智能判断是否为脚本错误
            let is_script_error = file_path_str.ends_with(".js") || 
                                error_msg.contains("Script syntax error") || 
                                error_msg.contains("Script must contain a main function") ||
                                error_msg.contains("Failed to read script file");
            
            if is_script_error {
                // 脚本错误使用专门的通知处理
                let result = (false, error_msg.clone());
                handle_script_validation_notice(&result, "脚本文件");
            } else {
                // 普通配置错误使用一般通知
                handle::Handle::notice_message("config_validate::error", &error_msg);
            }
            
            Ok(())
        }
        Err(e) => {
            println!("[cmd配置save] 验证过程发生错误: {}", e);
            // 恢复原始配置文件
            wrap_err!(fs::write(&file_path, original_content))?;
            Err(e.to_string())
        }
    }
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
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    log::info!(target: "app", "changing core to {clash_core}");
    
    match CoreManager::global().change_core(Some(clash_core.clone())).await {
        Ok(_) => {
            log::info!(target: "app", "core changed to {clash_core}");
            handle::Handle::notice_message("config_core::change_success", &clash_core);
            handle::Handle::refresh_clash();
            Ok(None)
        }
        Err(err) => {
            let error_msg = err.to_string();
            log::error!(target: "app", "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", &error_msg);
            Ok(Some(error_msg))
        }
    }
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

#[tauri::command]
pub async fn script_validate_notice(status: String, msg: String) -> CmdResult {
    handle::Handle::notice_message(&status, &msg);
    Ok(())
}

/// 处理脚本验证相关的所有消息通知
/// 统一通知接口，保持消息类型一致性
pub fn handle_script_validation_notice(result: &(bool, String), file_type: &str) {
    if !result.0 {
        let error_msg = &result.1;
        
        // 根据错误消息内容判断错误类型
        let status = if error_msg.starts_with("File not found:") {
            "config_validate::file_not_found"
        } else if error_msg.starts_with("Failed to read script file:") {
            "config_validate::script_error"
        } else if error_msg.starts_with("Script syntax error:") {
            "config_validate::script_syntax_error"
        } else if error_msg == "Script must contain a main function" {
            "config_validate::script_missing_main"
        } else {
            // 如果是其他类型错误，作为一般脚本错误处理
            "config_validate::script_error"
        };
        
        log::warn!(target: "app", "{} 验证失败: {}", file_type, error_msg);
        handle::Handle::notice_message(status, error_msg);
    }
}

/// 验证指定脚本文件
#[tauri::command]
pub async fn validate_script_file(file_path: String) -> CmdResult<bool> {
    log::info!(target: "app", "验证脚本文件: {}", file_path);
    
    match CoreManager::global().validate_config_file(&file_path).await {
        Ok(result) => {
            handle_script_validation_notice(&result, "脚本文件");
            Ok(result.0)  // 返回验证结果布尔值
        },
        Err(e) => {
            let error_msg = e.to_string();
            log::error!(target: "app", "验证脚本文件过程发生错误: {}", error_msg);
            handle::Handle::notice_message("config_validate::process_terminated", &error_msg);
            Ok(false)
        }
    }
}

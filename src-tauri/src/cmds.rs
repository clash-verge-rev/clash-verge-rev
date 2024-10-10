use crate::{
    config::*,
    core::*,
    enhance::{self, LogMessage, MergeResult},
    feat,
    utils::{dirs, help, resolve, tmpl},
};
use crate::{ret_err, wrap_err};
use anyhow::{Context, Result};
use backup::WebDav;
use reqwest_dav::list_cmd::ListFile;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::PathBuf,
};
use sysproxy::{Autoproxy, Sysproxy};
use tauri::{api, Manager};
use tray::Tray;
type CmdResult<T = ()> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmdMergeResult {
    config: String,
    logs: HashMap<String, Vec<LogMessage>>,
}

#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    Ok(Config::profiles().data().clone())
}

#[tauri::command]
pub fn get_template(scope: String, language: String) -> CmdResult<String> {
    match (scope.as_str(), language.as_str()) {
        ("merge", "yaml") => Ok(tmpl::ITEM_MERGE.into()),
        ("script", "javascript") => Ok(tmpl::ITEM_SCRIPT.into()),
        ("pac", "javascript") => Ok(DEFAULT_PAC.into()),
        _ => Ok("".into()),
    }
}

#[tauri::command]
pub fn get_default_bypass() -> CmdResult<String> {
    Ok(sysopt::get_default_bypass())
}

#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(CoreManager::global().update_config().await)?;
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

/// 修改profiles的
#[tauri::command]
pub async fn patch_profiles_config(profiles: IProfiles) -> CmdResult {
    wrap_err!({ Config::profiles().draft().patch_config(profiles) })?;

    match CoreManager::global().update_config().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            let _ = handle::Handle::update_systray_part();
            Config::profiles().apply();
            wrap_err!(Config::profiles().data().save_file())?;
            Ok(())
        }
        Err(err) => {
            Config::profiles().discard();
            log::error!(target: "app", "{err}");
            Err(format!("{err}"))
        }
    }
}

/// 修改某个profile item的
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    wrap_err!(Config::profiles().data().patch_item(index, profile))?;
    wrap_err!(timer::Timer::global().refresh_profiles())
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

#[tauri::command]
pub fn get_current_profile_rule_providers() -> CmdResult<HashMap<String, PathBuf>> {
    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let current = profiles.get_current();
    match current {
        Some(current) => {
            let item = profiles.get_item(&current).unwrap();
            if let Some(rule_providers_path) = &item.rule_providers_path {
                Ok(rule_providers_path.clone())
            } else {
                Ok(HashMap::new())
            }
        }
        None => Ok(HashMap::new()),
    }
}

#[tauri::command]
pub fn save_profile_file(index: String, file_data: Option<String>) -> CmdResult {
    if file_data.is_none() {
        return Ok(());
    }

    let profiles = Config::profiles();
    let profiles = profiles.latest();
    let item = wrap_err!(profiles.get_item(&index))?;
    wrap_err!(item.save_file(file_data.unwrap()))
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
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<LogMessage>>> {
    Ok(Config::runtime().latest().chain_logs.clone())
}

#[tauri::command]
pub fn get_pre_merge_result(modified_chain_id: String) -> CmdResult<CmdMergeResult> {
    let MergeResult { config, logs } = enhance::get_pre_merge_result(modified_chain_id).unwrap();
    let config = serde_yaml::to_string(&config)
        .map_err(|err| err.to_string())
        .unwrap();
    return Ok(CmdMergeResult { config, logs });
}

#[tauri::command]
pub fn test_merge_chain(modified_chain_id: String, content: String) -> CmdResult<CmdMergeResult> {
    let MergeResult { config, logs } =
        enhance::test_merge_chain(modified_chain_id, content).unwrap();
    let config = serde_yaml::to_string(&config)
        .map_err(|err| err.to_string())
        .unwrap();
    return Ok(CmdMergeResult { config, logs });
}

#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

#[tauri::command]
pub fn get_verge_config() -> CmdResult<IVerge> {
    Ok(Config::verge().data().clone())
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
pub fn get_clash_logs() -> CmdResult<VecDeque<String>> {
    Ok(logger::Logger::global().get_log())
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
    Ok(feat::test_delay(url).await.unwrap_or(5000u32))
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
pub fn open_devtools(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

#[tauri::command]
pub fn restart_app(app_handle: tauri::AppHandle) {
    let _ = resolve::save_window_size_position(&app_handle, true);
    let _ = CoreManager::global().stop_core();
    app_handle.restart();
}

#[tauri::command]
pub async fn restart_clash() -> CmdResult<()> {
    match clash_api::restart_core().await {
        Ok(_) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_clash_configs() -> CmdResult<bool> {
    match clash_api::get_configs().await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    let _ = resolve::save_window_size_position(&app_handle, true);
    resolve::resolve_reset();
    api::process::kill_children();
    app_handle.exit(0);
    std::process::exit(0);
}

pub mod service {
    use std::{thread::sleep, time::Duration};

    use super::*;
    use crate::core::service;

    #[tauri::command]
    pub async fn check_service() -> CmdResult<service::JsonResponse> {
        wrap_err!(service::check_service().await)
    }

    #[tauri::command]
    pub async fn install_service() -> CmdResult {
        wrap_err!(service::install_service().await)
    }

    #[tauri::command]
    pub async fn uninstall_service() -> CmdResult {
        wrap_err!(service::uninstall_service().await)
    }

    pub async fn check_service_and_clash() -> CmdResult<()> {
        for i in 0..5 {
            if let Err(_) = service::check_service().await {
                if i == 4 {
                    return Err("service check failed".to_string());
                } else {
                    sleep(Duration::from_secs(1));
                }
            };
        }
        for i in 0..5 {
            if let Err(_) = clash_api::get_configs().await {
                if i == 4 {
                    return Err("clash check failed".to_string());
                } else {
                    sleep(Duration::from_secs(1));
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
pub mod uwp {
    use super::*;

    #[tauri::command]
    pub async fn invoke_uwp_tool() -> CmdResult {
        Ok(())
    }
}

// backup
// #[tauri::command]
// pub async fn create_backup_local(only_backup_profiles: bool) -> CmdResult<(String, PathBuf)> {
//     let (file_name, file_path) = backup::create_backup(true, only_backup_profiles).unwrap();
//     Ok((file_name, file_path))
// }

// #[tauri::command]
// pub async fn extract_backup(file_path: String) -> CmdResult {
//     let mut zip: zip::ZipArchive<fs::File> =
//         zip::ZipArchive::new(fs::File::open(file_path).unwrap()).unwrap();
//     zip.extract(dirs::app_home_dir().unwrap()).unwrap();
//     // reload config
//     if let Err(e) = Config::reload() {
//         return Err(format!(
//             "download backup file success, but reload config failed. error: {:?}",
//             e
//         ));
//     }
//     Ok(())
// }

// web dav
#[tauri::command]
pub async fn update_webdav_info(url: String, username: String, password: String) -> CmdResult {
    match WebDav::global()
        .update_webdav_info(url, username, password)
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!(target: "app", "update webdav info failed. error: {e:?}");
            Err(format!("update webdav info failed."))
        }
    }
}

#[tauri::command]
pub async fn create_and_upload_backup(local_save: bool, only_backup_profiles: bool) -> CmdResult {
    let (file_name, file_path) = backup::create_backup(local_save, only_backup_profiles).unwrap();
    wrap_err!(WebDav::upload_file(file_path, file_name).await)
}

#[tauri::command]
pub async fn list_backup() -> CmdResult<Vec<ListFile>> {
    wrap_err!(WebDav::list_file().await)
}

#[tauri::command]
pub async fn download_backup_and_reload(file_name: String) -> CmdResult {
    let backup_archive = dirs::backup_archive_file().unwrap();
    if let Err(e) = WebDav::download_file(file_name, backup_archive.clone()).await {
        log::error!(target: "app", "download backup file failed. error: {e:?}");
        return Err(format!("download backup file failed. error: {:?}", e));
    }
    // extract zip file
    let mut zip = zip::ZipArchive::new(fs::File::open(backup_archive).unwrap()).unwrap();
    zip.extract(dirs::app_home_dir().unwrap()).unwrap();
    // TODO: reload config, Front-end problems must be solved, like websocket connection change and so on
    // if let Err(e) = Config::reload() {
    //     log::error!(target: "app", "download backup file success, but reload config failed. error: {e:?}");
    //     return Err(format!(
    //         "download backup file success, but reload config failed. error: {:?}",
    //         e
    //     ));
    // }
    Ok(())
}

#[tauri::command]
pub async fn delete_backup(file_name: String) -> CmdResult {
    wrap_err!(WebDav::delete_file(file_name).await)
}

#[tauri::command]
pub async fn set_tray_visible(app_handle: tauri::AppHandle, visible: bool) -> CmdResult {
    wrap_err!(Tray::set_tray_visible(&app_handle, visible))
}

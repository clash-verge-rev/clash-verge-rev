use crate::{
    config::*,
    core::*,
    feat,
    utils::{dirs, help},
};
use crate::{ret_err, wrap_err};
use anyhow::Result;
use serde_yaml::Mapping;
use std::collections::{HashMap, VecDeque};
use sysproxy::Sysproxy;

type CmdResult<T = ()> = Result<T, String>;

#[tauri::command]
pub fn get_profiles() -> CmdResult<IProfiles> {
    Ok(Config::profiles().data().clone())
}

#[tauri::command]
pub async fn enhance_profiles() -> CmdResult {
    wrap_err!(feat::handle_activate().await)
}

#[deprecated]
#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
    let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;
    wrap_err!(Config::profiles().data().append_item(item))
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
pub async fn select_profile(index: String) -> CmdResult {
    wrap_err!({ Config::profiles().draft().put_current(index) })?;

    match feat::handle_activate().await {
        Ok(_) => {
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

/// change the profile chain
#[tauri::command]
pub async fn change_profile_chain(chain: Option<Vec<String>>) -> CmdResult {
    wrap_err!({ Config::profiles().draft().put_chain(chain) })?;

    match feat::handle_activate().await {
        Ok(_) => {
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

#[tauri::command]
pub async fn change_profile_valid(valid: Option<Vec<String>>) -> CmdResult {
    wrap_err!({ Config::profiles().draft().put_valid(valid) })?;

    match feat::handle_activate().await {
        Ok(_) => {
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

#[tauri::command]
pub async fn delete_profile(index: String) -> CmdResult {
    let should_update = wrap_err!({ Config::profiles().data().delete_item(index) })?;
    if should_update {
        wrap_err!(feat::handle_activate().await)?;
    }

    Ok(())
}

#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
    wrap_err!(Config::profiles().data().patch_item(index, profile))?;

    wrap_err!(timer::Timer::global().refresh())
}

#[tauri::command]
pub fn view_profile(index: String) -> CmdResult {
    let file = {
        wrap_err!(Config::profiles().latest().get_item(&index))?
            .file
            .clone()
            .ok_or("the file field is null")
    }?;

    let path = dirs::app_profiles_dir().join(file);
    if !path.exists() {
        ret_err!("the file not found");
    }

    wrap_err!(help::open_file(path))
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
pub fn get_clash_info() -> CmdResult<ClashInfoN> {
    wrap_err!(Config::clash().latest().get_info())
}

#[tauri::command]
pub fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(CoreManager::global().runtime_config.lock().config.clone())
}

#[tauri::command]
pub fn get_runtime_yaml() -> CmdResult<Option<String>> {
    Ok(CoreManager::global()
        .runtime_config
        .lock()
        .config_yaml
        .clone())
}

#[tauri::command]
pub fn get_runtime_exists() -> CmdResult<Vec<String>> {
    Ok(CoreManager::global()
        .runtime_config
        .lock()
        .exists_keys
        .clone())
}

#[tauri::command]
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
    Ok(CoreManager::global()
        .runtime_config
        .lock()
        .chain_logs
        .clone())
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

#[tauri::command]
pub fn get_clash_logs() -> CmdResult<VecDeque<String>> {
    Ok(logger::Logger::global().get_log())
}

#[tauri::command]
pub fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir();
    wrap_err!(open::that(app_dir))
}

#[tauri::command]
pub fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir();
    wrap_err!(open::that(log_dir))
}

#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    wrap_err!(open::that(url))
}

#[cfg(windows)]
pub mod service {
    use super::*;
    use crate::core::win_service;

    #[tauri::command]
    pub async fn start_service() -> CmdResult {
        wrap_err!(win_service::start_service().await)
    }

    #[tauri::command]
    pub async fn stop_service() -> CmdResult {
        wrap_err!(win_service::stop_service().await)
    }

    #[tauri::command]
    pub async fn check_service() -> CmdResult<win_service::JsonResponse> {
        // no log
        match win_service::check_service().await {
            Ok(res) => Ok(res),
            Err(err) => Err(err.to_string()),
        }
    }

    #[tauri::command]
    pub async fn install_service() -> CmdResult {
        wrap_err!(win_service::install_service().await)
    }

    #[tauri::command]
    pub async fn uninstall_service() -> CmdResult {
        wrap_err!(win_service::uninstall_service().await)
    }
}

#[cfg(not(windows))]
pub mod service {
    use super::*;

    #[tauri::command]
    pub async fn start_service() -> CmdResult {
        Ok(())
    }
    #[tauri::command]
    pub async fn stop_service() -> CmdResult {
        Ok(())
    }
    #[tauri::command]
    pub async fn check_service() -> CmdResult {
        Ok(())
    }
    #[tauri::command]
    pub async fn install_service() -> CmdResult {
        Ok(())
    }
    #[tauri::command]
    pub async fn uninstall_service() -> CmdResult {
        Ok(())
    }
}

use crate::{
  core::Core,
  data::{ClashInfo, Data, PrfItem, PrfOption, Profiles, Verge},
  utils::{dirs, help},
};
use crate::{log_if_err, ret_err, wrap_err};
use anyhow::Result;
use serde_yaml::Mapping;
use std::collections::{HashMap, VecDeque};
use sysproxy::Sysproxy;

type CmdResult<T = ()> = Result<T, String>;

/// get all profiles from `profiles.yaml`
#[tauri::command]
pub fn get_profiles() -> CmdResult<Profiles> {
  let global = Data::global();
  let profiles = global.profiles.lock();
  Ok(profiles.clone())
}

/// manually exec enhanced profile
#[tauri::command]
pub fn enhance_profiles() -> CmdResult {
  let core = Core::global();
  wrap_err!(core.activate())
}

/// import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(url: String, option: Option<PrfOption>) -> CmdResult {
  let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;

  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.append_item(item))
}

/// new a profile
/// append a temp profile item file to the `profiles` dir
/// view the temp profile file by using vscode or other editor
#[tauri::command]
pub async fn create_profile(item: PrfItem, file_data: Option<String>) -> CmdResult {
  let item = wrap_err!(PrfItem::from(item, file_data).await)?;

  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.append_item(item))
}

/// Update the profile
#[tauri::command]
pub async fn update_profile(index: String, option: Option<PrfOption>) -> CmdResult {
  let core = Core::global();
  wrap_err!(core.update_profile_item(index, option).await)
}

/// change the current profile
#[tauri::command]
pub fn select_profile(index: String) -> CmdResult {
  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.put_current(index))?;
  drop(profiles);

  let core = Core::global();
  wrap_err!(core.activate())
}

/// change the profile chain
#[tauri::command]
pub fn change_profile_chain(chain: Option<Vec<String>>) -> CmdResult {
  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.put_chain(chain))?;
  drop(profiles);

  let core = Core::global();
  wrap_err!(core.activate())
}

/// change the profile valid fields
#[tauri::command]
pub fn change_profile_valid(valid: Option<Vec<String>>) -> CmdResult {
  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.put_valid(valid))?;
  drop(profiles);

  let core = Core::global();
  wrap_err!(core.activate())
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(index: String) -> CmdResult {
  let global = Data::global();
  let mut profiles = global.profiles.lock();
  if wrap_err!(profiles.delete_item(index))? {
    drop(profiles);

    let core = Core::global();
    log_if_err!(core.activate());
  }
  Ok(())
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem) -> CmdResult {
  let global = Data::global();
  let mut profiles = global.profiles.lock();
  wrap_err!(profiles.patch_item(index, profile))?;
  drop(profiles);

  // update cron task
  let core = Core::global();
  let mut timer = core.timer.lock();
  wrap_err!(timer.refresh())
}

/// run vscode command to edit the profile
#[tauri::command]
pub fn view_profile(index: String) -> CmdResult {
  let global = Data::global();
  let profiles = global.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;

  let file = item.file.clone();
  if file.is_none() {
    ret_err!("file is null");
  }

  let path = dirs::app_profiles_dir().join(file.unwrap());
  if !path.exists() {
    ret_err!("file not found");
  }

  wrap_err!(help::open_file(path))
}

/// read the profile item file data
#[tauri::command]
pub fn read_profile_file(index: String) -> CmdResult<String> {
  let global = Data::global();
  let profiles = global.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;
  let data = wrap_err!(item.read_file())?;
  Ok(data)
}

/// save the profile item file data
#[tauri::command]
pub fn save_profile_file(index: String, file_data: Option<String>) -> CmdResult {
  if file_data.is_none() {
    return Ok(());
  }

  let global = Data::global();
  let profiles = global.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;
  wrap_err!(item.save_file(file_data.unwrap()))
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info() -> CmdResult<ClashInfo> {
  let global = Data::global();
  let clash = global.clash.lock();
  Ok(clash.info.clone())
}

/// get the runtime clash config mapping
#[tauri::command]
pub fn get_runtime_config() -> CmdResult<Option<Mapping>> {
  let core = Core::global();
  let rt = core.runtime.lock();
  Ok(rt.config.clone())
}

/// get the runtime clash config yaml string
#[tauri::command]
pub fn get_runtime_yaml() -> CmdResult<Option<String>> {
  let core = Core::global();
  let rt = core.runtime.lock();
  Ok(rt.config_yaml.clone())
}

/// get the runtime config exists keys
#[tauri::command]
pub fn get_runtime_exists() -> CmdResult<Vec<String>> {
  let core = Core::global();
  let rt = core.runtime.lock();
  Ok(rt.exists_keys.clone())
}

/// get the runtime enhanced chain log
#[tauri::command]
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
  let core = Core::global();
  let rt = core.runtime.lock();
  Ok(rt.chain_logs.clone())
}

/// update the clash core config
/// after putting the change to the clash core
/// then we should save the latest config
#[tauri::command]
pub fn patch_clash_config(payload: Mapping) -> CmdResult {
  let core = Core::global();
  wrap_err!(core.patch_clash(payload))
}

#[tauri::command]
pub fn get_verge_config() -> CmdResult<Verge> {
  let global = Data::global();
  let verge = global.verge.lock();
  Ok(verge.clone())
}

/// patch the verge config
/// this command only save the config and not responsible for other things
#[tauri::command]
pub fn patch_verge_config(payload: Verge) -> CmdResult {
  let core = Core::global();
  wrap_err!(core.patch_verge(payload))
}

#[tauri::command]
pub fn update_hotkeys(hotkeys: Vec<String>) -> CmdResult {
  let core = Core::global();
  let mut hotkey = core.hotkey.lock();
  wrap_err!(hotkey.update(hotkeys))
}

/// change clash core
#[tauri::command]
pub fn change_clash_core(clash_core: Option<String>) -> CmdResult {
  let core = Core::global();
  wrap_err!(core.change_core(clash_core))
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar() -> CmdResult {
  let core = Core::global();
  wrap_err!(core.restart_clash())
}

/// kill all sidecars when update app
#[tauri::command]
pub fn kill_sidecar() {
  tauri::api::process::kill_children();
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
  let core = Core::global();
  let service = core.service.lock();
  Ok(service.get_logs())
}

/// open app config dir
#[tauri::command]
pub fn open_app_dir() -> CmdResult<()> {
  let app_dir = dirs::app_home_dir();
  wrap_err!(open::that(app_dir))
}

/// open logs dir
#[tauri::command]
pub fn open_logs_dir() -> CmdResult<()> {
  let log_dir = dirs::app_logs_dir();
  wrap_err!(open::that(log_dir))
}

/// open url
#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
  wrap_err!(open::that(url))
}

/// service mode
#[cfg(windows)]
pub mod service {
  use super::*;
  use crate::core::win_service::JsonResponse;

  #[tauri::command]
  pub async fn start_service() -> CmdResult<()> {
    wrap_err!(crate::core::Service::start_service().await)
  }

  #[tauri::command]
  pub async fn stop_service() -> CmdResult<()> {
    wrap_err!(crate::core::Service::stop_service().await)
  }

  #[tauri::command]
  pub async fn check_service() -> CmdResult<JsonResponse> {
    // no log
    match crate::core::Service::check_service().await {
      Ok(res) => Ok(res),
      Err(err) => Err(err.to_string()),
    }
  }

  #[tauri::command]
  pub async fn install_service() -> CmdResult<()> {
    wrap_err!(crate::core::Service::install_service().await)
  }

  #[tauri::command]
  pub async fn uninstall_service() -> CmdResult<()> {
    wrap_err!(crate::core::Service::uninstall_service().await)
  }
}

#[cfg(not(windows))]
pub mod service {
  use super::*;

  #[tauri::command]
  pub async fn start_service() -> CmdResult<()> {
    Ok(())
  }
  #[tauri::command]
  pub async fn stop_service() -> CmdResult<()> {
    Ok(())
  }
  #[tauri::command]
  pub async fn check_service() -> CmdResult<()> {
    Ok(())
  }
  #[tauri::command]
  pub async fn install_service() -> CmdResult<()> {
    Ok(())
  }
  #[tauri::command]
  pub async fn uninstall_service() -> CmdResult<()> {
    Ok(())
  }
}

use crate::{
  core::{ClashInfo, Core, PrfItem, PrfOption, Profiles, Verge},
  utils::{dirs, help, sysopt::SysProxyConfig},
};
use crate::{log_if_err, ret_err, wrap_err};
use anyhow::Result;
use serde_yaml::Mapping;
use std::collections::HashMap;
use tauri::{api, State};

type CmdResult<T = ()> = Result<T, String>;

/// get all profiles from `profiles.yaml`
#[tauri::command]
pub fn get_profiles(core: State<'_, Core>) -> CmdResult<Profiles> {
  let profiles = core.profiles.lock();
  Ok(profiles.clone())
}

/// manually exec enhanced profile
#[tauri::command]
pub fn enhance_profiles(core: State<'_, Core>) -> CmdResult {
  wrap_err!(core.activate())
}

/// import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(
  url: String,
  option: Option<PrfOption>,
  core: State<'_, Core>,
) -> CmdResult {
  let item = wrap_err!(PrfItem::from_url(&url, None, None, option).await)?;

  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.append_item(item))
}

/// new a profile
/// append a temp profile item file to the `profiles` dir
/// view the temp profile file by using vscode or other editor
#[tauri::command]
pub async fn create_profile(
  item: PrfItem, // partial
  file_data: Option<String>,
  core: State<'_, Core>,
) -> CmdResult {
  let item = wrap_err!(PrfItem::from(item, file_data).await)?;

  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.append_item(item))
}

/// Update the profile
#[tauri::command]
pub async fn update_profile(
  index: String,
  option: Option<PrfOption>,
  core: State<'_, Core>,
) -> CmdResult {
  wrap_err!(core.update_profile_item(index, option).await)
}

/// change the current profile
#[tauri::command]
pub fn select_profile(index: String, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.put_current(index))?;
  drop(profiles);
  wrap_err!(core.activate())
}

/// change the profile chain
#[tauri::command]
pub fn change_profile_chain(chain: Option<Vec<String>>, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.put_chain(chain))?;
  drop(profiles);
  wrap_err!(core.activate())
}

/// change the profile valid fields
#[tauri::command]
pub fn change_profile_valid(valid: Option<Vec<String>>, core: State<Core>) -> CmdResult {
  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.put_valid(valid))?;
  drop(profiles);
  wrap_err!(core.activate())
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(index: String, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock();
  if wrap_err!(profiles.delete_item(index))? {
    drop(profiles);
    log_if_err!(core.activate());
  }
  Ok(())
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock();
  wrap_err!(profiles.patch_item(index, profile))?;
  drop(profiles);

  // update cron task
  let mut timer = core.timer.lock();
  wrap_err!(timer.refresh())
}

/// run vscode command to edit the profile
#[tauri::command]
pub fn view_profile(index: String, core: State<'_, Core>) -> CmdResult {
  let profiles = core.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;

  let file = item.file.clone();
  if file.is_none() {
    ret_err!("the file is null");
  }

  let path = dirs::app_profiles_dir().join(file.unwrap());
  if !path.exists() {
    ret_err!("the file not found");
  }

  wrap_err!(help::open_file(path))
}

/// read the profile item file data
#[tauri::command]
pub fn read_profile_file(index: String, core: State<'_, Core>) -> CmdResult<String> {
  let profiles = core.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;
  let data = wrap_err!(item.read_file())?;
  Ok(data)
}

/// save the profile item file data
#[tauri::command]
pub fn save_profile_file(
  index: String,
  file_data: Option<String>,
  core: State<'_, Core>,
) -> CmdResult {
  if file_data.is_none() {
    return Ok(());
  }

  let profiles = core.profiles.lock();
  let item = wrap_err!(profiles.get_item(&index))?;
  wrap_err!(item.save_file(file_data.unwrap()))
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(core: State<'_, Core>) -> CmdResult<ClashInfo> {
  let clash = core.clash.lock();
  Ok(clash.info.clone())
}

/// get the runtime clash config mapping
#[tauri::command]
pub fn get_runtime_config(core: State<'_, Core>) -> CmdResult<Option<Mapping>> {
  let rt = core.runtime.lock();
  Ok(rt.config.clone())
}

/// get the runtime clash config yaml string
#[tauri::command]
pub fn get_runtime_yaml(core: State<'_, Core>) -> CmdResult<Option<String>> {
  let rt = core.runtime.lock();
  Ok(rt.config_yaml.clone())
}

/// get the runtime config exists keys
#[tauri::command]
pub fn get_runtime_exists(core: State<'_, Core>) -> CmdResult<Vec<String>> {
  let rt = core.runtime.lock();
  Ok(rt.exists_keys.clone())
}

/// get the runtime enhanced chain log
#[tauri::command]
pub fn get_runtime_logs(
  core: State<'_, Core>,
) -> CmdResult<HashMap<String, Vec<(String, String)>>> {
  let rt = core.runtime.lock();
  Ok(rt.chain_logs.clone())
}

/// update the clash core config
/// after putting the change to the clash core
/// then we should save the latest config
#[tauri::command]
pub fn patch_clash_config(
  payload: Mapping,
  app_handle: tauri::AppHandle,
  core: State<'_, Core>,
) -> CmdResult {
  wrap_err!(core.patch_clash(payload, &app_handle))
}

/// get the verge config
#[tauri::command]
pub fn get_verge_config(core: State<'_, Core>) -> CmdResult<Verge> {
  let verge = core.verge.lock();
  Ok(verge.clone())
}

/// patch the verge config
/// this command only save the config and not responsible for other things
#[tauri::command]
pub fn patch_verge_config(
  payload: Verge,
  app_handle: tauri::AppHandle,
  core: State<'_, Core>,
) -> CmdResult {
  wrap_err!(core.patch_verge(payload, &app_handle))
}

/// change clash core
#[tauri::command]
pub fn change_clash_core(core: State<'_, Core>, clash_core: Option<String>) -> CmdResult {
  wrap_err!(core.change_core(clash_core))
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(core: State<'_, Core>) -> CmdResult {
  wrap_err!(core.restart_clash())
}

/// kill all sidecars when update app
#[tauri::command]
pub fn kill_sidecar() {
  api::process::kill_children();
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> Result<SysProxyConfig, String> {
  wrap_err!(SysProxyConfig::get_sys())
}

/// get the current proxy config
/// which may not the same as system proxy
#[tauri::command]
pub fn get_cur_proxy(core: State<'_, Core>) -> CmdResult<Option<SysProxyConfig>> {
  let sysopt = core.sysopt.lock();
  wrap_err!(sysopt.get_sysproxy())
}

/// open app config dir
#[tauri::command]
pub fn open_app_dir() -> Result<(), String> {
  let app_dir = dirs::app_home_dir();
  wrap_err!(open::that(app_dir))
}

/// open logs dir
#[tauri::command]
pub fn open_logs_dir() -> Result<(), String> {
  let log_dir = dirs::app_logs_dir();
  wrap_err!(open::that(log_dir))
}

/// open url
#[tauri::command]
pub fn open_web_url(url: String) -> Result<(), String> {
  wrap_err!(open::that(url))
}

/// service mode
#[cfg(windows)]
pub mod service {
  use super::*;
  use crate::core::win_service::JsonResponse;

  #[tauri::command]
  pub async fn start_service() -> Result<(), String> {
    wrap_err!(crate::core::Service::start_service().await)
  }

  #[tauri::command]
  pub async fn stop_service() -> Result<(), String> {
    wrap_err!(crate::core::Service::stop_service().await)
  }

  #[tauri::command]
  pub async fn check_service() -> Result<JsonResponse, String> {
    // no log
    match crate::core::Service::check_service().await {
      Ok(res) => Ok(res),
      Err(err) => Err(err.to_string()),
    }
  }

  #[tauri::command]
  pub async fn install_service() -> Result<(), String> {
    wrap_err!(crate::core::Service::install_service().await)
  }

  #[tauri::command]
  pub async fn uninstall_service() -> Result<(), String> {
    wrap_err!(crate::core::Service::uninstall_service().await)
  }
}

#[cfg(not(windows))]
pub mod service {
  use super::*;

  #[tauri::command]
  pub async fn start_service() -> Result<(), String> {
    Ok(())
  }

  #[tauri::command]
  pub async fn stop_service() -> Result<(), String> {
    Ok(())
  }

  #[tauri::command]
  pub async fn check_service() -> Result<(), String> {
    Ok(())
  }

  #[tauri::command]
  pub async fn install_service() -> Result<(), String> {
    Ok(())
  }
  #[tauri::command]
  pub async fn uninstall_service() -> Result<(), String> {
    Ok(())
  }
}

use crate::{
  core::{ClashInfo, Core, PrfItem, PrfOption, Profiles, VergeConfig},
  utils::{dirs, sysopt::SysProxyConfig},
};
use crate::{log_if_err, ret_err, wrap_err};
use anyhow::Result;
use serde_yaml::Mapping;
use std::process::Command;
use tauri::{api, Manager, State};

type CmdResult<T = ()> = Result<T, String>;

/// get all profiles from `profiles.yaml`
#[tauri::command]
pub fn get_profiles(core: State<'_, Core>) -> CmdResult<Profiles> {
  let profiles = core.profiles.lock().unwrap();
  Ok(profiles.clone())
}

/// synchronize data irregularly
#[tauri::command]
pub fn sync_profiles(core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock().unwrap();
  wrap_err!(profiles.sync_file())
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

  let mut profiles = core.profiles.lock().unwrap();
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

  let mut profiles = core.profiles.lock().unwrap();
  wrap_err!(profiles.append_item(item))
}

/// Update the profile
#[tauri::command]
pub async fn update_profile(
  index: String,
  option: Option<PrfOption>,
  core: State<'_, Core>,
) -> CmdResult {
  let (url, opt) = {
    // must release the lock here
    let profiles = core.profiles.lock().unwrap();
    let item = wrap_err!(profiles.get_item(&index))?;

    // check the profile type
    if let Some(typ) = item.itype.as_ref() {
      if *typ != "remote" {
        ret_err!(format!("could not update the `{typ}` profile"));
      }
    }

    if item.url.is_none() {
      ret_err!("failed to get the item url");
    }

    (item.url.clone().unwrap(), item.option.clone())
  };

  let fetch_opt = PrfOption::merge(opt, option);
  let item = wrap_err!(PrfItem::from_url(&url, None, None, fetch_opt).await)?;

  let mut profiles = core.profiles.lock().unwrap();
  wrap_err!(profiles.update_item(index.clone(), item))?;

  // reactivate the profile
  if Some(index) == profiles.get_current() {
    log_if_err!(core.activate_enhanced(false, false));
  }

  Ok(())
}

/// change the current profile
#[tauri::command]
pub fn select_profile(index: String, core: State<'_, Core>) -> CmdResult {
  {
    let mut profiles = core.profiles.lock().unwrap();
    wrap_err!(profiles.put_current(index))?;
  }

  log_if_err!(core.activate_enhanced(false, false));

  Ok(())
}

/// change the profile chain
#[tauri::command]
pub fn change_profile_chain(chain: Option<Vec<String>>, core: State<'_, Core>) -> CmdResult {
  {
    let mut profiles = core.profiles.lock().unwrap();
    profiles.put_chain(chain);
  }

  log_if_err!(core.activate_enhanced(false, false));

  Ok(())
}

/// change the profile valid fields
#[tauri::command]
pub fn change_profile_valid(valid: Option<Vec<String>>, core: State<Core>) -> CmdResult {
  let mut profiles = core.profiles.lock().unwrap();
  profiles.put_valid(valid);

  log_if_err!(core.activate_enhanced(false, false));

  Ok(())
}

/// manually exec enhanced profile
#[tauri::command]
pub fn enhance_profiles(core: State<'_, Core>) -> CmdResult {
  log_if_err!(core.activate_enhanced(false, false));
  Ok(())
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(index: String, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock().unwrap();

  if wrap_err!(profiles.delete_item(index))? {
    log_if_err!(core.activate_enhanced(false, false));
  }

  Ok(())
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(index: String, profile: PrfItem, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock().unwrap();

  wrap_err!(profiles.patch_item(index, profile))
}

/// run vscode command to edit the profile
#[tauri::command]
pub fn view_profile(index: String, core: State<'_, Core>) -> CmdResult {
  let mut profiles = core.profiles.lock().unwrap();
  let item = wrap_err!(profiles.get_item(&index))?;

  let file = item.file.clone();
  if file.is_none() {
    ret_err!("the file is null");
  }

  let path = dirs::app_profiles_dir().join(file.unwrap());
  if !path.exists() {
    ret_err!("the file not found");
  }

  // use vscode first
  if let Ok(code) = which::which("code") {
    #[cfg(target_os = "windows")]
    {
      use std::os::windows::process::CommandExt;

      if let Err(err) = Command::new(code)
        .creation_flags(0x08000000)
        .arg(path)
        .spawn()
      {
        log::error!("failed to open file by VScode for {err}");
        return Err("failed to open file by VScode".into());
      }
    }

    #[cfg(not(target_os = "windows"))]
    if let Err(err) = Command::new(code).arg(path).spawn() {
      log::error!("failed to open file by VScode for {err}");
      return Err("failed to open file by VScode".into());
    }

    return Ok(());
  }

  wrap_err!(open::that(path))
}

/// read the profile item file data
#[tauri::command]
pub fn read_profile_file(index: String, core: State<'_, Core>) -> CmdResult<String> {
  let mut profiles = core.profiles.lock().unwrap();

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

  let mut profiles = core.profiles.lock().unwrap();
  let item = wrap_err!(profiles.get_item(&index))?;
  wrap_err!(item.save_file(file_data.unwrap()))
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(core: State<'_, Core>) -> CmdResult {
  let mut service = core.service.lock().unwrap();

  wrap_err!(service.restart())?;

  // 更新配置

  log_if_err!(core.activate_enhanced(false, false));

  Ok(())
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(core: State<'_, Core>) -> CmdResult<ClashInfo> {
  let clash = core.clash.lock().unwrap();
  Ok(clash.info.clone())
}

/// update the clash core config
/// after putting the change to the clash core
/// then we should save the latest config
#[tauri::command]
pub fn patch_clash_config(payload: Mapping, core: State<'_, Core>) -> CmdResult {
  wrap_err!(core.patch_clash(payload))
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
  let verge = core.verge.lock().unwrap();
  Ok(verge.cur_sysproxy.clone())
}

/// get the verge config
#[tauri::command]
pub fn get_verge_config(core: State<'_, Core>) -> CmdResult<VergeConfig> {
  let verge = core.verge.lock().unwrap();
  let mut config = verge.config.clone();

  if config.system_proxy_bypass.is_none() && verge.cur_sysproxy.is_some() {
    config.system_proxy_bypass = Some(verge.cur_sysproxy.clone().unwrap().bypass)
  }

  Ok(config)
}

/// patch the verge config
/// this command only save the config and not responsible for other things
#[tauri::command]
pub fn patch_verge_config(
  payload: VergeConfig,
  app_handle: tauri::AppHandle,
  core: State<'_, Core>,
) -> Result<(), String> {
  let tun_mode = payload.enable_tun_mode.clone();
  let system_proxy = payload.enable_system_proxy.clone();

  let mut verge = core.verge.lock().unwrap();
  wrap_err!(verge.patch_config(payload))?;

  // change tun mode
  if tun_mode.is_some() {
    #[cfg(target_os = "windows")]
    if *tun_mode.as_ref().unwrap() {
      let wintun_dll = dirs::app_home_dir().join("wintun.dll");
      if !wintun_dll.exists() {
        log::error!("failed to enable TUN for missing `wintun.dll`");
        return Err("failed to enable TUN for missing `wintun.dll`".into());
      }
    }

    let profiles = core.profiles.lock().unwrap();

    log_if_err!(core.activate_enhanced(false, false));
  }

  // change system tray
  if system_proxy.is_some() || tun_mode.is_some() {
    verge.update_systray(&app_handle).unwrap();
  }

  Ok(())
}

/// kill all sidecars when update app
#[tauri::command]
pub fn kill_sidecars() {
  api::process::kill_children();
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

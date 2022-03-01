use crate::{
  core::{ClashInfo, PrfItem, Profiles, VergeConfig},
  ret_err,
  states::{ClashState, ProfilesState, VergeState},
  utils::{dirs, sysopt::SysProxyConfig},
  wrap_err,
};
use anyhow::Result;
use serde_yaml::Mapping;
use std::{path::PathBuf, process::Command};
use tauri::{api, State};

/// get all profiles from `profiles.yaml`
#[tauri::command]
pub fn get_profiles<'a>(profiles_state: State<'_, ProfilesState>) -> Result<Profiles, String> {
  let profiles = profiles_state.0.lock().unwrap();
  Ok(profiles.clone())
}

/// synchronize data irregularly
#[tauri::command]
pub fn sync_profiles(profiles_state: State<'_, ProfilesState>) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(profiles.sync_file())
}

/// import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(
  url: String,
  with_proxy: bool,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let item = wrap_err!(PrfItem::from_url(&url, with_proxy).await)?;

  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(profiles.append_item(item))
}

/// new a profile
/// append a temp profile item file to the `profiles` dir
/// view the temp profile file by using vscode or other editor
#[tauri::command]
pub async fn new_profile(
  name: String,
  desc: String,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let item = wrap_err!(PrfItem::from_local(name, desc))?;
  let mut profiles = profiles_state.0.lock().unwrap();

  wrap_err!(profiles.append_item(item))
}

/// Update the profile
#[tauri::command]
pub async fn update_profile(
  index: String,
  with_proxy: bool,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let url = {
    // must release the lock here
    let profiles = profiles_state.0.lock().unwrap();
    let item = wrap_err!(profiles.get_item(&index))?;

    if item.url.is_none() {
      ret_err!("failed to get the item url");
    }

    item.url.clone().unwrap()
  };

  let item = wrap_err!(PrfItem::from_url(&url, with_proxy).await)?;

  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(profiles.update_item(index.clone(), item))?;

  // reactivate the profile
  if Some(index) == profiles.get_current() {
    let clash = clash_state.0.lock().unwrap();
    wrap_err!(clash.activate(&profiles))?;
  }

  Ok(())
}

/// change the current profile
#[tauri::command]
pub fn select_profile(
  index: String,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(profiles.put_current(index))?;

  let clash = clash_state.0.lock().unwrap();
  wrap_err!(clash.activate(&profiles))
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(
  index: String,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();

  if wrap_err!(profiles.delete_item(index))? {
    let clash = clash_state.0.lock().unwrap();
    wrap_err!(clash.activate(&profiles))?;
  }

  Ok(())
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(
  index: String,
  profile: PrfItem,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(profiles.patch_item(index, profile))
}

/// run vscode command to edit the profile
#[tauri::command]
pub fn view_profile(index: String, profiles_state: State<'_, ProfilesState>) -> Result<(), String> {
  let profiles = profiles_state.0.lock().unwrap();
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

      return match Command::new(code)
        .creation_flags(0x08000000)
        .arg(path)
        .spawn()
      {
        Ok(_) => Ok(()),
        Err(_) => Err("failed to open file by VScode".into()),
      };
    }

    #[cfg(not(target_os = "windows"))]
    return match Command::new(code).arg(path).spawn() {
      Ok(_) => Ok(()),
      Err(_) => Err("failed to open file by VScode".into()),
    };
  }

  open_path_cmd(path, "failed to open file by `open`")
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut clash = clash_state.0.lock().unwrap();
  let mut profiles = profiles_state.0.lock().unwrap();

  wrap_err!(clash.restart_sidecar(&mut profiles))
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(clash_state: State<'_, ClashState>) -> Result<ClashInfo, String> {
  let clash = clash_state.0.lock().unwrap();
  Ok(clash.info.clone())
}

/// update the clash core config
/// after putting the change to the clash core
/// then we should save the latest config
#[tauri::command]
pub fn patch_clash_config(
  payload: Mapping,
  clash_state: State<'_, ClashState>,
  verge_state: State<'_, VergeState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut clash = clash_state.0.lock().unwrap();
  let mut verge = verge_state.0.lock().unwrap();
  let mut profiles = profiles_state.0.lock().unwrap();
  wrap_err!(clash.patch_config(payload, &mut verge, &mut profiles))
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> Result<SysProxyConfig, String> {
  wrap_err!(SysProxyConfig::get_sys())
}

/// get the current proxy config
/// which may not the same as system proxy
#[tauri::command]
pub fn get_cur_proxy(verge_state: State<'_, VergeState>) -> Result<Option<SysProxyConfig>, String> {
  let verge = verge_state.0.lock().unwrap();
  Ok(verge.cur_sysproxy.clone())
}

/// get the verge config
#[tauri::command]
pub fn get_verge_config(verge_state: State<'_, VergeState>) -> Result<VergeConfig, String> {
  let verge = verge_state.0.lock().unwrap();
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
  clash_state: State<'_, ClashState>,
  verge_state: State<'_, VergeState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let tun_mode = payload.enable_tun_mode.clone();

  let mut verge = verge_state.0.lock().unwrap();
  wrap_err!(verge.patch_config(payload))?;

  // change tun mode
  if tun_mode.is_some() {
    let mut clash = clash_state.0.lock().unwrap();
    let profiles = profiles_state.0.lock().unwrap();

    wrap_err!(clash.tun_mode(tun_mode.unwrap()))?;
    clash.update_config();
    wrap_err!(clash.activate(&profiles))?;
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
  open_path_cmd(app_dir, "failed to open app dir")
}

/// open logs dir
#[tauri::command]
pub fn open_logs_dir() -> Result<(), String> {
  let log_dir = dirs::app_logs_dir();
  open_path_cmd(log_dir, "failed to open logs dir")
}

/// get open/explorer command
fn open_path_cmd(dir: PathBuf, err_str: &str) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;

    match Command::new("explorer")
      .creation_flags(0x08000000)
      .arg(dir)
      .spawn()
    {
      Ok(_) => Ok(()),
      Err(_) => Err(err_str.into()),
    }
  }

  #[cfg(not(target_os = "windows"))]
  match Command::new("open").arg(dir).spawn() {
    Ok(_) => Ok(()),
    Err(_) => Err(err_str.into()),
  }
}

use crate::{
  core::{ClashInfo, ProfileItem, Profiles, VergeConfig},
  states::{ClashState, ProfilesState, VergeState},
  utils::{dirs::app_home_dir, fetch::fetch_profile, sysopt::SysProxyConfig},
};
use serde_yaml::Mapping;
use std::process::Command;
use tauri::State;

/// get all profiles from `profiles.yaml`
/// do not acquire the lock of ProfileLock
#[tauri::command]
pub fn get_profiles(profiles_state: State<'_, ProfilesState>) -> Result<Profiles, String> {
  match profiles_state.0.lock() {
    Ok(profiles) => Ok(profiles.clone()),
    Err(_) => Err("failed to get profiles lock".into()),
  }
}

/// synchronize data irregularly
#[tauri::command]
pub fn sync_profiles(profiles_state: State<'_, ProfilesState>) -> Result<(), String> {
  match profiles_state.0.lock() {
    Ok(mut profiles) => profiles.sync_file(),
    Err(_) => Err("failed to get profiles lock".into()),
  }
}

/// import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(
  url: String,
  with_proxy: bool,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  match fetch_profile(&url, with_proxy).await {
    Some(result) => {
      let mut profiles = profiles_state.0.lock().unwrap();
      profiles.import_from_url(url, result)
    }
    None => Err(format!("failed to fetch profile from `{}`", url)),
  }
}

/// Update the profile
#[tauri::command]
pub async fn update_profile(
  index: usize,
  with_proxy: bool,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  // maybe we can get the url from the web app directly
  let url = match profiles_state.0.lock() {
    Ok(mut profile) => {
      let items = profile.items.take().unwrap_or(vec![]);
      if index >= items.len() {
        return Err("the index out of bound".into());
      }
      let url = match &items[index].url {
        Some(u) => u.clone(),
        None => return Err("failed to update profile for `invalid url`".into()),
      };
      profile.items = Some(items);
      url
    }
    Err(_) => return Err("failed to get profiles lock".into()),
  };

  match fetch_profile(&url, with_proxy).await {
    Some(result) => match profiles_state.0.lock() {
      Ok(mut profiles) => {
        profiles.update_item(index, result)?;

        // reactivate the profile
        let current = profiles.current.clone().unwrap_or(0);
        if current == index {
          let clash = clash_state.0.lock().unwrap();
          profiles.activate(&clash)
        } else {
          Ok(())
        }
      }
      Err(_) => Err("failed to get profiles lock".into()),
    },
    None => Err(format!("failed to fetch profile from `{}`", url)),
  }
}

/// change the current profile
#[tauri::command]
pub fn select_profile(
  index: usize,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();

  match profiles.put_current(index) {
    Ok(()) => {
      let clash = clash_state.0.lock().unwrap();
      profiles.activate(&clash)
    }
    Err(err) => Err(err),
  }
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(
  index: usize,
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();
  match profiles.delete_item(index) {
    Ok(change) => match change {
      true => {
        let clash = clash_state.0.lock().unwrap();
        profiles.activate(&clash)
      }
      false => Ok(()),
    },
    Err(err) => Err(err),
  }
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(
  index: usize,
  profile: ProfileItem,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  match profiles_state.0.lock() {
    Ok(mut profiles) => profiles.patch_item(index, profile),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// run vscode command to edit the profile
#[tauri::command]
pub fn view_profile(index: usize, profiles_state: State<'_, ProfilesState>) -> Result<(), String> {
  let mut profiles = profiles_state.0.lock().unwrap();
  let items = profiles.items.take().unwrap_or(vec![]);

  if index >= items.len() {
    profiles.items = Some(items);
    return Err("the index out of bound".into());
  }

  let file = items[index].file.clone().unwrap_or("".into());
  profiles.items = Some(items);

  let path = app_home_dir().join("profiles").join(file);
  if !path.exists() {
    return Err("failed to open the file".into());
  }

  match which::which("code") {
    Ok(code) => match Command::new(code).arg(path).status() {
      Ok(_) => Ok(()),
      Err(_) => Err("failed to open file by VScode".into()),
    },
    Err(_) => Err("please install VScode for edit".into()),
  }
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(
  clash_state: State<'_, ClashState>,
  profiles_state: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut clash = clash_state.0.lock().unwrap();
  let mut profiles = profiles_state.0.lock().unwrap();

  match clash.restart_sidecar(&mut profiles) {
    Ok(_) => Ok(()),
    Err(err) => {
      log::error!("{}", err);
      Err(err)
    }
  }
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(clash_state: State<'_, ClashState>) -> Result<ClashInfo, String> {
  match clash_state.0.lock() {
    Ok(clash) => Ok(clash.info.clone()),
    Err(_) => Err("failed to get clash lock".into()),
  }
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
  clash.patch_config(payload, &mut verge, &mut profiles)
}

/// get the system proxy
#[tauri::command]
pub fn get_sys_proxy() -> Result<SysProxyConfig, String> {
  match SysProxyConfig::get_sys() {
    Ok(value) => Ok(value),
    Err(err) => Err(err.to_string()),
  }
}

/// get the current proxy config
/// which may not the same as system proxy
#[tauri::command]
pub fn get_cur_proxy(verge_state: State<'_, VergeState>) -> Result<Option<SysProxyConfig>, String> {
  match verge_state.0.lock() {
    Ok(verge) => Ok(verge.cur_sysproxy.clone()),
    Err(_) => Err("failed to get verge lock".into()),
  }
}

/// get the verge config
#[tauri::command]
pub fn get_verge_config(verge_state: State<'_, VergeState>) -> Result<VergeConfig, String> {
  match verge_state.0.lock() {
    Ok(arc) => Ok(arc.config.clone()),
    Err(_) => Err("failed to get verge lock".into()),
  }
}

/// patch the verge config
/// this command only save the config and not responsible for other things
#[tauri::command]
pub async fn patch_verge_config(
  payload: VergeConfig,
  verge_state: State<'_, VergeState>,
) -> Result<(), String> {
  let mut verge = verge_state.0.lock().unwrap();
  verge.patch_config(payload)
}

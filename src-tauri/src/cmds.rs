use crate::{
  config::{ClashInfo, ProfileItem, ProfilesConfig, VergeConfig},
  states::{ClashState, ProfilesState, VergeState},
  utils::{
    config::{read_clash, save_clash},
    fetch::fetch_profile,
    sysopt::SysProxyConfig,
  },
};
use serde_yaml::Mapping;
use tauri::State;

/// get all profiles from `profiles.yaml`
/// do not acquire the lock of ProfileLock
#[tauri::command]
pub fn get_profiles(profiles: State<'_, ProfilesState>) -> Result<ProfilesConfig, String> {
  match profiles.0.lock() {
    Ok(profiles) => Ok(profiles.clone()),
    Err(_) => Err("failed to get profiles lock".into()),
  }
}

/// synchronize data irregularly
#[tauri::command]
pub fn sync_profiles(profiles: State<'_, ProfilesState>) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.sync_file(),
    Err(_) => Err("failed to get profiles lock".into()),
  }
}

/// Import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(url: String, profiles: State<'_, ProfilesState>) -> Result<(), String> {
  match fetch_profile(&url).await {
    Some(result) => {
      let mut profiles = profiles.0.lock().unwrap();
      profiles.import_from_url(url, result)
    }
    None => Err(format!("failed to fetch profile from `{}`", url)),
  }
}

/// Update the profile
/// and save to `profiles.yaml`
/// http request firstly
/// then acquire the lock of `profiles.yaml`
#[tauri::command]
pub async fn update_profile(
  index: usize,
  clash: State<'_, ClashState>,
  profiles: State<'_, ProfilesState>,
) -> Result<(), String> {
  // maybe we can get the url from the web app directly
  let url = match profiles.0.lock() {
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

  match fetch_profile(&url).await {
    Some(result) => match profiles.0.lock() {
      Ok(mut profiles) => {
        profiles.update_item(index, result)?;

        // reactivate the profile
        let current = profiles.current.clone().unwrap_or(0);
        if current == index {
          let clash = clash.0.lock().unwrap();
          profiles.activate(clash.info.clone())
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
  clash: State<'_, ClashState>,
  profiles: State<'_, ProfilesState>,
) -> Result<(), String> {
  let mut profiles = profiles.0.lock().unwrap();

  match profiles.put_current(index) {
    Ok(()) => {
      let clash = clash.0.lock().unwrap();
      profiles.activate(clash.info.clone())
    }
    Err(err) => Err(err),
  }
}

/// todo: need to check
/// delete profile item
#[tauri::command]
pub fn delete_profile(index: usize, profiles: State<'_, ProfilesState>) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.delete_item(index),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(
  index: usize,
  profile: ProfileItem,
  profiles: State<'_, ProfilesState>,
) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.patch_item(index, profile),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(clash_state: State<'_, ClashState>) {
  let mut clash_arc = clash_state.0.lock().unwrap();
  if let Err(err) = clash_arc.restart_sidecar() {
    log::error!("{}", err);
  }
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(clash_state: State<'_, ClashState>) -> Result<ClashInfo, String> {
  match clash_state.0.lock() {
    Ok(arc) => Ok(arc.info.clone()),
    Err(_) => Err("failed to get clash lock".into()),
  }
}

/// todo: need refactor
/// update the clash core config
/// after putting the change to the clash core
/// then we should save the latest config
#[tauri::command]
pub fn patch_clash_config(payload: Mapping) -> Result<(), String> {
  let mut config = read_clash();
  for (key, value) in payload.iter() {
    if config.contains_key(key) {
      config[key] = value.clone();
    } else {
      config.insert(key.clone(), value.clone());
    }
  }
  save_clash(&config)
}

/// set the system proxy
/// Tips: only support windows now
#[tauri::command]
pub fn set_sys_proxy(enable: bool, verge_state: State<'_, VergeState>) -> Result<(), String> {
  let mut verge = verge_state.0.lock().unwrap();

  if let Some(mut sysproxy) = verge.cur_sysproxy.take() {
    sysproxy.enable = enable;
    if sysproxy.set_sys().is_err() {
      log::error!("failed to set system proxy");
    }
    verge.cur_sysproxy = Some(sysproxy);
  }
  Ok(())
}

/// get the system proxy
/// Tips: only support windows now
#[tauri::command]
pub fn get_sys_proxy() -> Result<SysProxyConfig, String> {
  match SysProxyConfig::get_sys() {
    Ok(value) => Ok(value),
    Err(err) => Err(err.to_string()),
  }
}

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

  if payload.theme_mode.is_some() {
    verge.config.theme_mode = payload.theme_mode;
  }

  if payload.enable_self_startup.is_some() {
    verge.config.enable_self_startup = payload.enable_self_startup;
  }

  if payload.enable_system_proxy.is_some() {
    verge.config.enable_system_proxy = payload.enable_system_proxy;
  }

  if payload.system_proxy_bypass.is_some() {
    verge.config.system_proxy_bypass = payload.system_proxy_bypass;
  }

  verge.config.save_file()
}

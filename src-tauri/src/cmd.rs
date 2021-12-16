use crate::{
  config::{read_profiles, save_profiles, ProfileItem, ProfilesConfig},
  events::{
    emit::ClashInfoPayload,
    state::{ClashInfoState, ProfileLock},
  },
  utils::{
    app_home_dir,
    clash::{self, put_clash_profile},
    fetch::fetch_profile,
    sysopt::{set_proxy_config, SysProxyConfig},
  },
};
use std::fs::File;
use std::io::Write;
use tauri::{api::process::kill_children, AppHandle, State};

#[tauri::command]
pub fn restart_sidebar(app_handle: AppHandle, clash_info: State<'_, ClashInfoState>) {
  kill_children();
  let payload = clash::run_clash_bin(&app_handle);

  if let Ok(mut arc) = clash_info.0.lock() {
    *arc = payload;
  }
}

#[tauri::command]
pub fn get_clash_info(clash_info: State<'_, ClashInfoState>) -> Option<ClashInfoPayload> {
  match clash_info.0.lock() {
    Ok(arc) => Some(arc.clone()),
    _ => None,
  }
}

/// Import the Profile from url and
/// save to the `profiles.yaml` file
#[tauri::command]
pub async fn import_profile(url: String, lock: State<'_, ProfileLock>) -> Result<String, String> {
  let result = match fetch_profile(&url).await {
    Some(r) => r,
    None => {
      log::error!("failed to fetch profile from `{}`", url);
      return Err(format!("failed"));
    }
  };

  let path = app_home_dir().join("profiles").join(&result.file);
  File::create(path)
    .unwrap()
    .write(result.data.as_bytes())
    .unwrap();

  // get lock
  match lock.0.lock() {
    Ok(_) => {}
    Err(_) => return Err(format!("can not get file locked")),
  };

  // update profiles.yaml
  let mut profiles = read_profiles();
  let mut items = match profiles.items {
    Some(p) => p,
    None => vec![],
  };

  let profile = ProfileItem {
    name: Some(result.name),
    file: Some(result.file),
    mode: Some(format!("rule")),
    url: Some(url),
    selected: Some(vec![]), // Todo: parse the selected list
    extra: Some(result.extra),
  };

  items.push(profile);
  profiles.items = Some(items);
  save_profiles(&profiles);

  Ok(format!("success"))
}

#[tauri::command]
pub fn get_profiles(lock: State<'_, ProfileLock>) -> Option<ProfilesConfig> {
  match lock.0.lock() {
    Ok(_) => Some(read_profiles()),
    Err(_) => None,
  }
}

#[tauri::command]
/// update the profile config
pub fn set_profiles(
  current: usize,
  profile: ProfileItem,
  lock: State<'_, ProfileLock>,
) -> Result<(), String> {
  match lock.0.lock() {
    Ok(_) => {}
    Err(_) => return Err(format!("can not get file locked")),
  };

  let mut profiles = read_profiles();
  let mut items = match profiles.items {
    Some(p) => p,
    None => vec![],
  };

  if current >= items.len() {
    return Err(format!("out of profiles bound"));
  }

  let mut origin = items[current].clone();

  if profile.name.is_some() {
    origin.name = profile.name;
  }
  if profile.file.is_some() {
    origin.file = profile.file;
  }
  if profile.mode.is_some() {
    origin.mode = profile.mode;
  }
  if profile.url.is_some() {
    origin.url = profile.url;
  }
  if profile.selected.is_some() {
    origin.selected = profile.selected;
  }
  if profile.extra.is_some() {
    origin.extra = profile.extra;
  }

  items[current] = origin;
  profiles.items = Some(items);
  save_profiles(&profiles);

  Ok(())
}

#[tauri::command]
/// change to target profile
pub async fn put_profiles(
  current: usize,
  lock: State<'_, ProfileLock>,
  clash_info: State<'_, ClashInfoState>,
) -> Result<(), String> {
  match lock.0.lock() {
    Ok(_) => {}
    Err(_) => return Err(format!("can not get file locked")),
  };

  let clash_info = match clash_info.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err(format!("can not get clash info")),
  };

  let mut profiles = read_profiles();
  let items_len = match &profiles.items {
    Some(p) => p.len(),
    None => 0,
  };

  if current >= items_len {
    return Err(format!(
      "failed to change profile to the index `{}`",
      current
    ));
  }

  profiles.current = Some(current as u32);
  save_profiles(&profiles);
  put_clash_profile(&clash_info).await
}

#[tauri::command]
/// set system proxy
pub fn set_sys_proxy(enable: bool, clash_info: State<'_, ClashInfoState>) -> Result<(), String> {
  let clash_info = match clash_info.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err(format!("can not get clash info")),
  };

  let port = match clash_info.controller {
    Some(ctrl) => ctrl.port,
    None => None,
  };

  if port.is_none() {
    return Err(format!("can not get clash core's port"));
  }

  let config = if enable {
    let server = format!("127.0.0.1:{}", port.unwrap());
    // todo
    let bypass = String::from("localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*");

    SysProxyConfig {
      enable,
      server,
      bypass,
    }
  } else {
    SysProxyConfig {
      enable,
      server: String::from(""),
      bypass: String::from(""),
    }
  };

  match set_proxy_config(&config) {
    Ok(_) => Ok(()),
    Err(_) => Err(format!("can not set proxy")),
  }
}

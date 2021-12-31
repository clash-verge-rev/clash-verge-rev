use crate::{
  config::VergeConfig,
  events::{
    emit::ClashInfoPayload,
    state::{ClashInfoState, ClashSidecarState, VergeConfLock},
  },
  utils::{
    clash::run_clash_bin,
    config::{read_clash, save_clash, save_verge},
    sysopt::{get_proxy_config, set_proxy_config, SysProxyConfig, DEFAULT_BYPASS},
  },
};
use serde_yaml::Mapping;
use tauri::{AppHandle, State};

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(
  app_handle: AppHandle,
  clash_info: State<'_, ClashInfoState>,
  clash_sidecar: State<'_, ClashSidecarState>,
) {
  {
    let mut guard = clash_sidecar.0.lock().unwrap();
    let sidecar = guard.take();
    if sidecar.is_some() {
      if let Err(err) = sidecar.unwrap().kill() {
        log::error!("failed to restart clash for \"{}\"", err);
      }
    }
  }
  let payload = run_clash_bin(&app_handle);

  if let Ok(mut arc) = clash_info.0.lock() {
    *arc = payload;
  }
}

/// get the clash core info from the state
/// the caller can also get the infomation by clash's api
#[tauri::command]
pub fn get_clash_info(clash_info: State<'_, ClashInfoState>) -> Result<ClashInfoPayload, String> {
  match clash_info.0.lock() {
    Ok(arc) => Ok(arc.clone()),
    Err(_) => Err(format!("can not get clash info")),
  }
}

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
pub fn set_sys_proxy(
  enable: bool,
  clash_info: State<'_, ClashInfoState>,
  verge_lock: State<'_, VergeConfLock>,
) -> Result<(), String> {
  let clash_info = match clash_info.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err(format!("can not get clash info")),
  };

  let verge_info = match verge_lock.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err(format!("can not get verge info")),
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
    let bypass = verge_info
      .system_proxy_bypass
      .unwrap_or(String::from(DEFAULT_BYPASS));
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

/// get the system proxy
/// Tips: only support windows now
#[tauri::command]
pub fn get_sys_proxy() -> Result<SysProxyConfig, String> {
  match get_proxy_config() {
    Ok(value) => Ok(value),
    Err(err) => Err(err.to_string()),
  }
}

/// get the verge config
#[tauri::command]
pub fn get_verge_config(verge_lock: State<'_, VergeConfLock>) -> Result<VergeConfig, String> {
  match verge_lock.0.lock() {
    Ok(arc) => Ok(arc.clone()),
    Err(_) => Err(format!("can not get the lock")),
  }
}

/// patch the verge config
/// this command only save the config and not responsible for other things
#[tauri::command]
pub async fn patch_verge_config(
  payload: VergeConfig,
  verge_lock: State<'_, VergeConfLock>,
) -> Result<(), String> {
  let mut verge = match verge_lock.0.lock() {
    Ok(v) => v,
    Err(_) => return Err(format!("can not get the lock")),
  };

  if payload.theme_mode.is_some() {
    verge.theme_mode = payload.theme_mode;
  }

  // todo
  if payload.enable_self_startup.is_some() {
    verge.enable_self_startup = payload.enable_self_startup;
  }

  // todo
  if payload.enable_system_proxy.is_some() {
    verge.enable_system_proxy = payload.enable_system_proxy;
  }

  if payload.system_proxy_bypass.is_some() {
    verge.system_proxy_bypass = payload.system_proxy_bypass;
  }

  save_verge(&verge)
}

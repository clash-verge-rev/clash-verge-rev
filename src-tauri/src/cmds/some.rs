use crate::{
  events::{emit::ClashInfoPayload, state::ClashInfoState},
  utils::{
    clash::run_clash_bin,
    sysopt::{set_proxy_config, SysProxyConfig},
  },
};
use tauri::{api::process::kill_children, AppHandle, State};

/// restart the sidecar
#[tauri::command]
pub fn restart_sidecar(app_handle: AppHandle, clash_info: State<'_, ClashInfoState>) {
  kill_children();
  let payload = run_clash_bin(&app_handle);

  if let Ok(mut arc) = clash_info.0.lock() {
    *arc = payload;
  }
}

/// get the clash core info from the state
#[tauri::command]
pub fn get_clash_info(clash_info: State<'_, ClashInfoState>) -> Result<ClashInfoPayload, String> {
  match clash_info.0.lock() {
    Ok(arc) => Ok(arc.clone()),
    Err(_) => Err(format!("can not get clash info")),
  }
}

/// set the system proxy
/// Tips: only support windows now
#[tauri::command]
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

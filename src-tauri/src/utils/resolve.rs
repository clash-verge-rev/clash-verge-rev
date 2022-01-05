use super::{clash, config, init, server, sysopt};
use crate::{config::ProfilesConfig, events::state};
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &App) {
  // setup a simple http server for singleton
  server::embed_server(&app.handle());

  // init app config
  init::init_app(app.package_info());

  // run clash sidecar
  let info = clash::run_clash_bin(&app.handle());

  // resolve the verge config - enable system proxy
  let mut original: Option<sysopt::SysProxyConfig> = None;
  let verge = config::read_verge();
  let enable = verge.enable_system_proxy.unwrap_or(false);

  if enable && info.controller.is_some() {
    if let Ok(original_conf) = sysopt::get_proxy_config() {
      original = Some(original_conf)
    };
    let ctl = info.controller.clone().unwrap();
    if ctl.port.is_some() {
      let server = format!("127.0.0.1:{}", ctl.port.unwrap());
      let bypass = verge
        .system_proxy_bypass
        .clone()
        .unwrap_or(String::from(sysopt::DEFAULT_BYPASS));
      let config = sysopt::SysProxyConfig {
        enable,
        server,
        bypass,
      };
      if let Err(err) = sysopt::set_proxy_config(&config) {
        log::error!("can not set system proxy for `{}`", err);
      }
    }
  }

  // update state
  let profiles_state = app.state::<state::ProfilesState>();
  let mut profiles = profiles_state.0.lock().unwrap();
  *profiles = ProfilesConfig::read_file();

  let verge_state = app.state::<state::VergeConfLock>();
  let mut verge_arc = verge_state.0.lock().unwrap();
  *verge_arc = verge;

  let clash_state = app.state::<state::ClashInfoState>();
  let mut clash_arc = clash_state.0.lock().unwrap();
  *clash_arc = info;

  let some_state = app.state::<state::SomthingState>();
  let mut some_arc = some_state.0.lock().unwrap();
  *some_arc = original;
}

/// reset system proxy
pub fn resolve_reset(app_handle: &AppHandle) {
  let state = app_handle.try_state::<state::SomthingState>();
  if state.is_none() {
    return;
  }
  match state.unwrap().0.lock() {
    Ok(arc) => {
      if arc.is_some() {
        if let Err(err) = sysopt::set_proxy_config(arc.as_ref().unwrap()) {
          log::error!("failed to reset proxy for `{}`", err);
        }
      }
    }
    _ => {}
  };
}

use super::{init, server};
use crate::{core::ProfilesConfig, states};
use tauri::{App, AppHandle, Manager};
use tauri_plugin_shadows::Shadows;

/// handle something when start app
pub fn resolve_setup(app: &App) {
  // set shadow when window decorations
  let window = app.get_window("main").unwrap();
  window.set_shadow(true);

  // setup a simple http server for singleton
  server::embed_server(&app.handle());

  // init app config
  init::init_app(app.package_info());

  // init states
  let clash_state = app.state::<states::ClashState>();
  let verge_state = app.state::<states::VergeState>();
  let profiles_state = app.state::<states::ProfilesState>();

  let mut clash = clash_state.0.lock().unwrap();
  let mut verge = verge_state.0.lock().unwrap();
  let mut profiles = profiles_state.0.lock().unwrap();

  if let Err(err) = clash.run_sidecar() {
    log::error!("{}", err);
  }

  *profiles = ProfilesConfig::read_file();
  if let Err(err) = profiles.activate(clash.info.clone()) {
    log::error!("{}", err);
  }

  verge.set_exe_path(app.package_info());
  verge.init_sysproxy(clash.info.port.clone());
  if let Err(err) = verge.sync_startup() {
    log::error!("{}", err);
  }
}

/// reset system proxy
pub fn resolve_reset(app_handle: &AppHandle) {
  let verge_state = app_handle.state::<states::VergeState>();
  let mut verge = verge_state.0.lock().unwrap();

  verge.reset_sysproxy();
}

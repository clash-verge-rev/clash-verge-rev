use super::{init, server};
use crate::{core::Profiles, log_if_err, states};
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &App) {
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

  log_if_err!(clash.run_sidecar());

  *profiles = Profiles::read_file();

  clash.set_window(app.get_window("main"));
  log_if_err!(clash.activate(&profiles));
  log_if_err!(clash.activate_enhanced(&profiles, true, true));

  verge.init_sysproxy(clash.info.port.clone());

  log_if_err!(verge.init_launch());

  verge.config.enable_system_proxy.map(|enable| {
    log_if_err!(app
      .tray_handle()
      .get_item("system_proxy")
      .set_selected(enable));
  });

  resolve_window(app, verge.config.enable_silent_start.clone());
}

/// reset system proxy
pub fn resolve_reset(app_handle: &AppHandle) {
  let verge_state = app_handle.state::<states::VergeState>();
  let mut verge = verge_state.0.lock().unwrap();

  verge.reset_sysproxy();
}

/// customize the window theme
fn resolve_window(app: &App, hide: Option<bool>) {
  let window = app.get_window("main").unwrap();

  // silent start
  hide.map(|hide| {
    if hide {
      window.hide().unwrap();
    }
  });

  #[cfg(target_os = "windows")]
  {
    use window_shadows::set_shadow;
    use window_vibrancy::apply_blur;

    window.set_decorations(false).unwrap();
    set_shadow(&window, true).unwrap();
    apply_blur(&window, None).unwrap();
  }

  #[cfg(target_os = "macos")]
  {
    use tauri::LogicalSize;
    use tauri::Size::Logical;
    window.set_decorations(true).unwrap();
    window
      .set_size(Logical(LogicalSize {
        width: 800.0,
        height: 610.0,
      }))
      .unwrap();
    // use tauri_plugin_vibrancy::MacOSVibrancy;
    // #[allow(deprecated)]
    // window.apply_vibrancy(MacOSVibrancy::AppearanceBased);
  }
}

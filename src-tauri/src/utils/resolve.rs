use crate::log_if_err;
use crate::{core::Core, utils::init, utils::server};
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &App) {
  // setup a simple http server for singleton
  server::embed_server(&app.handle());

  // init app config
  init::init_app(app.package_info());

  // init states
  let core = app.state::<Core>();

  core.set_win(app.get_window("main"));
  core.init();

  // clash.set_window(app.get_window("main"));
  // log_if_err!(clash.run_sidecar(&profiles, true));

  resolve_window(app, None);
}

/// reset system proxy
pub fn resolve_reset(app_handle: &AppHandle) {
  let core = app_handle.state::<Core>();
  let mut verge = core.verge.lock().unwrap();

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

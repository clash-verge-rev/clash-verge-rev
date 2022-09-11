use crate::{core::Core, data::Data, utils::init, utils::server};
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &App) {
  // init app config
  init::init_app(app.package_info());

  {
    let global = Data::global();
    let verge = global.verge.lock();
    let singleton = verge.app_singleton_port.clone();

    // setup a simple http server for singleton
    server::embed_server(&app.handle(), singleton);
  }

  // core should be initialized after init_app fix #122
  let core = Core::global();
  core.init(app.app_handle());

  resolve_window(app);
}

/// reset system proxy
pub fn resolve_reset() {
  let core = Core::global();
  let mut sysopt = core.sysopt.lock();
  crate::log_if_err!(sysopt.reset_sysproxy());
  drop(sysopt);

  let mut service = core.service.lock();
  crate::log_if_err!(service.stop());
}

/// customize the window theme
fn resolve_window(app: &App) {
  let window = app.get_window("main").unwrap();

  #[cfg(target_os = "windows")]
  {
    use crate::utils::winhelp;
    use window_shadows::set_shadow;
    use window_vibrancy::apply_blur;

    let _ = window.set_decorations(false);
    let _ = set_shadow(&window, true);

    // todo
    // win11 disable this feature temporarily due to lag
    if !winhelp::is_win11() {
      let _ = apply_blur(&window, None);
    }
  }

  #[cfg(target_os = "macos")]
  {
    use tauri::LogicalSize;
    use tauri::Size::Logical;

    let _ = window.set_decorations(true);
    let _ = window.set_size(Logical(LogicalSize {
      width: 800.0,
      height: 620.0,
    }));
  }
}

/// create main window
pub fn create_window(app_handle: &AppHandle) {
  if let Some(window) = app_handle.get_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    return;
  }

  let builder = tauri::window::WindowBuilder::new(
    app_handle,
    "main".to_string(),
    tauri::WindowUrl::App("index.html".into()),
  )
  .title("Clash Verge")
  .center()
  .fullscreen(false)
  .min_inner_size(600.0, 520.0);

  #[cfg(target_os = "windows")]
  {
    use crate::utils::winhelp;
    use std::time::Duration;
    use tokio::time::sleep;
    use window_shadows::set_shadow;
    use window_vibrancy::apply_blur;

    match builder
      .decorations(false)
      .transparent(true)
      .inner_size(800.0, 636.0)
      .build()
    {
      Ok(_) => {
        let app_handle = app_handle.clone();

        tauri::async_runtime::spawn(async move {
          sleep(Duration::from_secs(1)).await;

          if let Some(window) = app_handle.get_window("main") {
            let _ = window.show();
            let _ = set_shadow(&window, true);

            if !winhelp::is_win11() {
              let _ = apply_blur(&window, None);
            }
          }
        });
      }
      Err(err) => log::error!(target: "app", "{err}"),
    }
  }

  #[cfg(target_os = "macos")]
  crate::log_if_err!(builder.decorations(true).inner_size(800.0, 620.0).build());

  #[cfg(target_os = "linux")]
  crate::log_if_err!(builder
    .decorations(false)
    .transparent(true)
    .inner_size(800.0, 636.0)
    .build());
}

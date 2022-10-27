#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod cmds;
mod config;
mod core;
mod data;
mod feat;
mod utils;

use crate::utils::{init, resolve, server};
use tauri::{api, Manager, SystemTray};

fn main() -> std::io::Result<()> {
  // 单例检测
  if server::check_singleton().is_err() {
    println!("app exists");
    return Ok(());
  }

  #[cfg(target_os = "windows")]
  unsafe {
    use crate::utils::dirs;
    dirs::init_portable_flag();
  }

  crate::log_if_err!(init::init_config());

  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default()
    .setup(|app| Ok(resolve::resolve_setup(app)))
    .system_tray(SystemTray::new().with_menu(core::tray::Tray::tray_menu()))
    .on_system_tray_event(core::tray::Tray::on_system_tray_event)
    .invoke_handler(tauri::generate_handler![
      // common
      cmds::get_sys_proxy,
      cmds::open_app_dir,
      cmds::open_logs_dir,
      cmds::open_web_url,
      cmds::kill_sidecar,
      cmds::restart_sidecar,
      // clash
      cmds::get_clash_info,
      cmds::get_clash_logs,
      cmds::patch_clash_config,
      cmds::change_clash_core,
      cmds::get_runtime_config,
      cmds::get_runtime_yaml,
      cmds::get_runtime_exists,
      cmds::get_runtime_logs,
      // verge
      cmds::get_verge_config,
      cmds::patch_verge_config,
      cmds::update_hotkeys,
      // profile
      cmds::view_profile,
      cmds::patch_profile,
      cmds::create_profile,
      cmds::import_profile,
      cmds::update_profile,
      cmds::delete_profile,
      cmds::select_profile,
      cmds::get_profiles,
      cmds::enhance_profiles,
      cmds::change_profile_chain,
      cmds::change_profile_valid,
      cmds::read_profile_file,
      cmds::save_profile_file,
      // service mode
      cmds::service::start_service,
      cmds::service::stop_service,
      cmds::service::check_service,
      cmds::service::install_service,
      cmds::service::uninstall_service,
    ]);

  #[cfg(target_os = "macos")]
  {
    use tauri::{Menu, MenuItem, Submenu};

    builder = builder.menu(
      Menu::new().add_submenu(Submenu::new(
        "File",
        Menu::new()
          .add_native_item(MenuItem::Undo)
          .add_native_item(MenuItem::Redo)
          .add_native_item(MenuItem::Copy)
          .add_native_item(MenuItem::Paste)
          .add_native_item(MenuItem::Cut)
          .add_native_item(MenuItem::SelectAll),
      )),
    );
  }

  #[allow(unused_mut)]
  let mut app = builder
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  #[cfg(target_os = "macos")]
  app.set_activation_policy(tauri::ActivationPolicy::Accessory);

  let app_handle = app.app_handle();
  ctrlc::set_handler(move || {
    resolve::resolve_reset();
    app_handle.exit(0);
  })
  .expect("error while exiting.");

  #[allow(unused)]
  app.run(|app_handle, e| match e {
    tauri::RunEvent::ExitRequested { api, .. } => {
      api.prevent_exit();
    }
    tauri::RunEvent::Exit => {
      resolve::resolve_reset();
      api::process::kill_children();
      app_handle.exit(0);
    }
    #[cfg(target_os = "macos")]
    tauri::RunEvent::WindowEvent { label, event, .. } => {
      if label == "main" {
        match event {
          tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            app_handle.get_window("main").map(|win| {
              let _ = win.hide();
            });
          }
          _ => {}
        }
      }
    }
    _ => {}
  });

  Ok(())
}

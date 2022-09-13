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

use crate::{
  data::Verge,
  utils::{resolve, server},
};
use tauri::{
  api, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

fn main() -> std::io::Result<()> {
  let mut context = tauri::generate_context!();

  let verge = Verge::new();

  if server::check_singleton(verge.app_singleton_port).is_err() {
    println!("app exists");
    return Ok(());
  }

  for win in context.config_mut().tauri.windows.iter_mut() {
    if verge.enable_silent_start.unwrap_or(false) {
      win.visible = false;
    }
  }

  #[cfg(target_os = "windows")]
  unsafe {
    use crate::utils::dirs;
    dirs::init_portable_flag();
  }

  let tray_menu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("open_window", "Show"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("rule_mode", "Rule Mode"))
    .add_item(CustomMenuItem::new("global_mode", "Global Mode"))
    .add_item(CustomMenuItem::new("direct_mode", "Direct Mode"))
    .add_item(CustomMenuItem::new("script_mode", "Script Mode"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("system_proxy", "System Proxy"))
    .add_item(CustomMenuItem::new("tun_mode", "Tun Mode"))
    .add_item(CustomMenuItem::new("restart_clash", "Restart Clash"))
    .add_item(CustomMenuItem::new("restart_app", "Restart App"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("quit", "Quit").accelerator("CmdOrControl+Q"));

  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default()
    .setup(|app| Ok(resolve::resolve_setup(app)))
    .system_tray(SystemTray::new().with_menu(tray_menu))
    .on_system_tray_event(move |app_handle, event| match event {
      SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
        "open_window" => {
          resolve::create_window(app_handle);
        }
        mode @ ("rule_mode" | "global_mode" | "direct_mode" | "script_mode") => {
          let mode = &mode[0..mode.len() - 5];
          feat::change_clash_mode(mode);
        }
        "system_proxy" => feat::toggle_system_proxy(),
        "tun_mode" => feat::toggle_tun_mode(),
        "restart_app" => {
          api::process::restart(&app_handle.env());
        }
        "quit" => {
          resolve::resolve_reset();
          app_handle.exit(0);
        }
        _ => {}
      },
      #[cfg(target_os = "windows")]
      SystemTrayEvent::LeftClick { .. } => {
        resolve::create_window(app_handle);
      }
      _ => {}
    })
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

    let submenu_file = Submenu::new(
      "File",
      Menu::new()
        .add_native_item(MenuItem::Undo)
        .add_native_item(MenuItem::Redo)
        .add_native_item(MenuItem::Copy)
        .add_native_item(MenuItem::Paste)
        .add_native_item(MenuItem::Cut)
        .add_native_item(MenuItem::SelectAll),
    );
    builder = builder.menu(Menu::new().add_submenu(submenu_file));
  }

  let app = builder
    .build(context)
    .expect("error while running tauri application");

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

#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod cmds;
mod core;
mod states;
mod utils;

use crate::utils::{resolve, server};
use tauri::{
  api, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

fn main() -> std::io::Result<()> {
  if server::check_singleton().is_err() {
    println!("app exists");
    return Ok(());
  }

  let menu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("open_window", "Show"))
    .add_item(CustomMenuItem::new("restart_clash", "Restart Clash"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("quit", "Quit").accelerator("CmdOrControl+Q"));

  tauri::Builder::default()
    .manage(states::VergeState::default())
    .manage(states::ClashState::default())
    .manage(states::ProfilesState::default())
    .setup(|app| Ok(resolve::resolve_setup(app)))
    .system_tray(SystemTray::new().with_menu(menu))
    .on_system_tray_event(move |app_handle, event| match event {
      SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
        "open_window" => {
          let window = app_handle.get_window("main").unwrap();
          window.show().unwrap();
          window.set_focus().unwrap();
        }
        "restart_clash" => {
          let clash_state = app_handle.state::<states::ClashState>();
          let mut clash = clash_state.0.lock().unwrap();
          match clash.restart_sidecar() {
            Ok(_) => {
              let profiles = app_handle.state::<states::ProfilesState>();
              let profiles = profiles.0.lock().unwrap();
              if let Err(err) = profiles.activate(clash.info.clone()) {
                log::error!("{}", err);
              }
            }
            Err(err) => log::error!("{}", err),
          }
        }
        "quit" => {
          api::process::kill_children();
          resolve::resolve_reset(app_handle);
          app_handle.exit(0);
        }
        _ => {}
      },
      SystemTrayEvent::LeftClick { .. } => {
        let window = app_handle.get_window("main").unwrap();
        window.show().unwrap();
        window.set_focus().unwrap();
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      // common
      cmds::restart_sidecar,
      cmds::get_sys_proxy,
      cmds::get_cur_proxy,
      cmds::win_drag,
      cmds::win_hide,
      cmds::win_mini,
      // clash
      cmds::get_clash_info,
      cmds::patch_clash_config,
      // verge
      cmds::get_verge_config,
      cmds::patch_verge_config,
      // profile
      cmds::import_profile,
      cmds::update_profile,
      cmds::delete_profile,
      cmds::select_profile,
      cmds::patch_profile,
      cmds::sync_profiles,
      cmds::get_profiles,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app_handle, e| match e {
      tauri::Event::CloseRequested { label, api, .. } => {
        let app_handle = app_handle.clone();
        api.prevent_close();
        app_handle.get_window(&label).unwrap().hide().unwrap();
      }
      tauri::Event::ExitRequested { .. } => {
        resolve::resolve_reset(app_handle);
        api::process::kill_children();
      }
      _ => {}
    });

  Ok(())
}

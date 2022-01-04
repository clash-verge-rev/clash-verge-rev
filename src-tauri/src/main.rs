#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod cmds;
mod config;
mod events;
mod utils;

use crate::{
  events::state,
  utils::{clash, resolve, server},
};
use tauri::{
  api, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
};

fn main() -> std::io::Result<()> {
  if server::check_singleton().is_err() {
    println!("app exists");
    return Ok(());
  }

  let menu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("open_window", "显示应用"))
    .add_item(CustomMenuItem::new("restart_clash", "重启clash"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("quit", "退出").accelerator("CmdOrControl+Q"));

  tauri::Builder::default()
    .manage(state::ClashSidecarState::default())
    .manage(state::VergeConfLock::default())
    .manage(state::ClashInfoState::default())
    .manage(state::SomthingState::default())
    .manage(state::ProfilesState::default())
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
          {
            let state = app_handle.state::<state::ClashSidecarState>();
            let mut guard = state.0.lock().unwrap();
            let sidecar = guard.take();
            if sidecar.is_some() {
              if let Err(err) = sidecar.unwrap().kill() {
                log::error!("failed to restart clash for \"{}\"", err);
              }
            }
          }

          let payload = clash::run_clash_bin(&app_handle);
          let state = app_handle.state::<state::ClashInfoState>();
          if let Ok(mut arc) = state.0.lock() {
            *arc = payload;
          };
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
      cmds::some::restart_sidecar,
      cmds::some::set_sys_proxy,
      cmds::some::get_sys_proxy,
      cmds::some::get_clash_info,
      cmds::some::patch_clash_config,
      cmds::some::get_verge_config,
      cmds::some::patch_verge_config,
      cmds::profile::import_profile,
      cmds::profile::update_profile,
      cmds::profile::delete_profile,
      cmds::profile::select_profile,
      cmds::profile::patch_profile,
      cmds::profile::sync_profiles,
      cmds::profile::get_profiles,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app_handle, e| match e {
      tauri::Event::CloseRequested { label, api, .. } => {
        let app_handle = app_handle.clone();
        api.prevent_close();
        app_handle.get_window(&label).unwrap().hide().unwrap();
      }
      tauri::Event::ExitRequested { api, .. } => {
        api.prevent_exit();
      }
      tauri::Event::Exit => {
        resolve::resolve_reset(app_handle);
        api::process::kill_children();
      }
      _ => {}
    });

  Ok(())
}

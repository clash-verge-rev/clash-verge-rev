#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod cmds;
mod config;
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
    .add_item(CustomMenuItem::new("open_window", "显示应用"))
    .add_item(CustomMenuItem::new("restart_clash", "重启clash"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("quit", "退出").accelerator("CmdOrControl+Q"));

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
          let mut clash_arc = clash_state.0.lock().unwrap();
          if let Err(err) = clash_arc.restart_sidecar() {
            log::error!("{}", err);
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
      cmds::restart_sidecar,
      cmds::set_sys_proxy,
      cmds::get_sys_proxy,
      cmds::get_cur_proxy,
      cmds::get_clash_info,
      cmds::patch_clash_config,
      cmds::get_verge_config,
      cmds::patch_verge_config,
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

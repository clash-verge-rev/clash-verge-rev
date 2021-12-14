#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod cmd;
mod config;
mod events;
mod utils;

use crate::{events::state, utils::clash::put_clash_profile};
use std::sync::{Arc, Mutex};
use tauri::{
  api, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
  SystemTraySubmenu,
};

fn main() -> std::io::Result<()> {
  let sub_menu = SystemTraySubmenu::new(
    "出站规则",
    SystemTrayMenu::new()
      .add_item(CustomMenuItem::new("rway_global", "全局连接"))
      .add_item(CustomMenuItem::new("rway_rule", "规则连接").selected())
      .add_item(CustomMenuItem::new("rway_direct", "直接连接")),
  );
  let menu = SystemTrayMenu::new()
    .add_submenu(sub_menu)
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("syste_proxy", "设置为系统代理"))
    .add_item(CustomMenuItem::new("self_startup", "开机启动").selected())
    .add_item(CustomMenuItem::new("open_window", "显示应用"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("quit", "退出").accelerator("CmdOrControl+Q"));

  let app = tauri::Builder::default()
    .system_tray(SystemTray::new().with_menu(menu))
    .on_system_tray_event(move |app, event| match event {
      SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
        "open_window" => {
          let window = app.get_window("main").unwrap();
          window.show().unwrap();
          window.set_focus().unwrap();
        }
        "quit" => {
          api::process::kill_children();
          app.exit(0);
        }
        _ => {}
      },
      SystemTrayEvent::LeftClick { .. } => {
        let window = app.get_window("main").unwrap();
        window.show().unwrap();
        window.set_focus().unwrap();
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      cmd::restart_sidebar,
      cmd::get_clash_info,
      cmd::import_profile,
      cmd::get_profiles,
      cmd::set_profiles
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  // init app config
  utils::init::init_app(app.package_info());
  // run clash sidecar
  let info = utils::clash::run_clash_bin(&app.handle());
  // update the profile
  let info_copy = info.clone();
  tauri::async_runtime::spawn(async move {
    match put_clash_profile(&info_copy).await {
      Ok(_) => {}
      Err(err) => log::error!("failed to put config for `{}`", err),
    };
  });

  app.manage(state::ClashInfoState(Arc::new(Mutex::new(info))));
  app.manage(state::ProfileLock::default());

  app.run(|app_handle, e| match e {
    tauri::Event::CloseRequested { label, api, .. } => {
      let app_handle = app_handle.clone();
      api.prevent_close();
      app_handle.get_window(&label).unwrap().hide().unwrap();
    }
    tauri::Event::ExitRequested { api, .. } => {
      api.prevent_exit();
    }
    tauri::Event::Exit => {
      api::process::kill_children();
    }
    _ => {}
  });

  Ok(())
}

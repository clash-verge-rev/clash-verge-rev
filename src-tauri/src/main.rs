#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod clash;
mod cmd;
mod config;
mod init;
mod profiles;
mod sysopt;

use tauri::{
  CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem,
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
      cmd::cmd_import_profile,
      cmd::cmd_restart_sidebar,
    ])
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  // init app config
  init::init_app(app.package_info());
  // clash::run_clash_bin();

  // 通过clash config初始化menu和tray
  // 通过verge config干点别的

  app.run(|app_handle, e| match e {
    tauri::Event::CloseRequested { label, api, .. } => {
      let app_handle = app_handle.clone();
      api.prevent_close();
      app_handle.get_window(&label).unwrap().hide().unwrap();
    }
    tauri::Event::ExitRequested { api, .. } => {
      api.prevent_exit();
    }
    _ => {}
  });

  Ok(())
}

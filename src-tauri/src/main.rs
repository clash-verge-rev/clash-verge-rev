#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

extern crate tauri;

mod clash;
mod sysopt;

use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};

#[tauri::command]
async fn get_config_data(url: String) -> Result<String, String> {
  match clash::fetch_url(&url).await {
    Ok(_) => Ok(String::from("success")),
    Err(_) => Err(String::from("error")),
  }
}

fn main() -> std::io::Result<()> {
  let config = sysopt::get_proxy_config()?;
  println!("{:?}", config);

  let app = tauri::Builder::default()
    .system_tray(
      SystemTray::new()
        .with_menu(SystemTrayMenu::new().add_item(CustomMenuItem::new("tray_event_quit", "Quit"))),
    )
    .on_system_tray_event(move |app, event| match event {
      SystemTrayEvent::LeftClick { .. } => {
        let window = app.get_window("main").unwrap();
        window.show().unwrap();
        window.set_focus().unwrap();
      }

      SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
        "tray_event_quit" => {
          app.exit(0);
        }
        _ => {}
      },
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![get_config_data])
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

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

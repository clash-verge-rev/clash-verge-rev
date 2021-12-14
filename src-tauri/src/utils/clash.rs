extern crate log;

use crate::utils::app_home_dir;
use tauri::api::process::{Command, CommandEvent};

/// Run the clash bin
pub fn run_clash_bin() {
  let app_dir = app_home_dir();

  let (mut rx, _sidecar) = Command::new_sidecar("clash")
    .expect("failed to create clash binary")
    .args(["-d", &app_dir.as_os_str().to_str().unwrap()])
    .spawn()
    .expect("failed to spawn sidecar");

  tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) => {
          log::info!("{}", line);
        }
        CommandEvent::Stderr(err) => {
          log::error!("{}", err);
        }
        _ => {}
      }
    }
  });
}

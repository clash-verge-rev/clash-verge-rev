extern crate log;

use crate::{
  config::read_clash_controller,
  events::emit::{clash_start, ClashInfoPayload},
  utils::app_home_dir,
};
use tauri::{
  api::process::{Command, CommandEvent},
  AppHandle,
};

/// Run the clash bin
pub fn run_clash_bin(app_handle: &AppHandle) -> ClashInfoPayload {
  let app_dir = app_home_dir();
  let mut payload = ClashInfoPayload {
    status: "success".to_string(),
    controller: None,
    message: None,
  };

  match Command::new_sidecar("clash") {
    Ok(cmd) => match cmd
      .args(["-d", &app_dir.as_os_str().to_str().unwrap()])
      .spawn()
    {
      Ok((mut rx, _)) => {
        log::info!("Successfully execute clash sidecar");
        payload.controller = Some(read_clash_controller());

        tauri::async_runtime::spawn(async move {
          while let Some(event) = rx.recv().await {
            match event {
              CommandEvent::Stdout(line) => log::info!("{}", line),
              CommandEvent::Stderr(err) => log::error!("{}", err),
              _ => {}
            }
          }
        });
      }
      Err(err) => {
        log::error!(
          "Failed to execute clash sidecar for \"{:?}\"",
          err.to_string()
        );
        payload.status = "error".to_string();
        payload.message = Some(err.to_string());
      }
    },
    Err(err) => {
      log::error!(
        "Failed to execute clash sidecar for \"{:?}\"",
        err.to_string()
      );
      payload.status = "error".to_string();
      payload.message = Some(err.to_string());
    }
  };

  clash_start(app_handle, &payload);

  payload
}

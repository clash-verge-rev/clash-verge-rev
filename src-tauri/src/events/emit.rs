use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::config::ClashController;

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashInfoPayload {
  /// value between `success` and `error`
  pub status: String,

  /// the clash core's external controller infomation
  pub controller: Option<ClashController>,

  /// some message
  pub message: Option<String>,
}

/// emit `clash_runtime` to the main windows
pub fn clash_start(app_handle: &AppHandle, payload: &ClashInfoPayload) {
  match app_handle.get_window("main") {
    Some(main_win) => {
      main_win.emit("clash_start", payload).unwrap();
    }
    _ => {}
  };
}

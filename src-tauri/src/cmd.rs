use crate::{
  events::{emit::ClashInfoPayload, state::ClashInfoState},
  utils::{clash, import},
};
use tauri::{api::process::kill_children, AppHandle, State};

#[tauri::command]
pub fn restart_sidebar(app_handle: AppHandle, clash_info: State<'_, ClashInfoState>) {
  kill_children();
  let payload = clash::run_clash_bin(&app_handle);

  if let Ok(mut arc) = clash_info.0.lock() {
    *arc = payload;
  }
}

#[tauri::command]
pub async fn import_profile(url: String) -> Result<String, String> {
  match import::import_profile(&url).await {
    Ok(_) => Ok(String::from("success")),
    Err(_) => Err(String::from("error")),
  }
}

#[tauri::command]
pub fn get_clash_info(clash_info: State<'_, ClashInfoState>) -> Option<ClashInfoPayload> {
  match clash_info.0.lock() {
    Ok(arc) => Some(arc.clone()),
    _ => None,
  }
}

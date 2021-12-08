use crate::clash;
use tauri::api::process::kill_children;

#[tauri::command]
pub fn restart_sidebar() {
  kill_children();
  clash::run_clash_bin();
}

#[tauri::command]
pub async fn get_config_data(url: String) -> Result<String, String> {
  match clash::fetch_url(&url).await {
    Ok(_) => Ok(String::from("success")),
    Err(_) => Err(String::from("error")),
  }
}

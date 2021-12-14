use crate::{
  config::{read_profiles, save_profiles, ProfileItem},
  events::{emit::ClashInfoPayload, state::ClashInfoState},
  utils::{app_home_dir, clash, fetch::fetch_profile},
};
use std::fs::File;
use std::io::Write;
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
pub fn get_clash_info(clash_info: State<'_, ClashInfoState>) -> Option<ClashInfoPayload> {
  match clash_info.0.lock() {
    Ok(arc) => Some(arc.clone()),
    _ => None,
  }
}

/// Import the Profile from url and
/// save to the `profiles.yaml` file
#[tauri::command]
pub async fn import_profile(url: String) -> Result<String, String> {
  let result = match fetch_profile(&url).await {
    Some(r) => r,
    None => {
      log::error!("failed to fetch profile from `{}`", url);
      return Err(format!("failed"));
    }
  };

  let path = app_home_dir().join("profiles").join(&result.file);
  File::create(path)
    .unwrap()
    .write(result.data.as_bytes())
    .unwrap();

  // update profiles.yaml
  let mut profiles = read_profiles();
  let mut items = match profiles.items {
    Some(p) => p,
    None => vec![],
  };

  let profile = ProfileItem {
    name: Some(result.name),
    file: Some(result.file),
    mode: Some(format!("rule")),
    url: Some(url),
    selected: Some(vec![]), // Todo: parse the selected list
    extra: Some(result.extra),
  };

  items.push(profile);
  profiles.items = Some(items);
  save_profiles(&profiles);

  Ok(format!("success"))
}

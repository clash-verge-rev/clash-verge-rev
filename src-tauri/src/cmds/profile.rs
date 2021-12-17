use crate::{
  config::{read_profiles, save_profiles, ProfileItem, ProfilesConfig},
  events::state::{ClashInfoState, ProfileLock},
  utils::{app_home_dir, clash::put_clash_profile, fetch::fetch_profile},
};
use std::fs::File;
use std::io::Write;
use tauri::State;

/// Import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(url: String, lock: State<'_, ProfileLock>) -> Result<(), String> {
  let result = match fetch_profile(&url).await {
    Some(r) => r,
    None => {
      log::error!("failed to fetch profile from `{}`", url);
      return Err(format!("failed to fetch profile from `{}`", url));
    }
  };

  // get lock
  if lock.0.lock().is_err() {
    return Err(format!("can not get file lock"));
  }

  // save the profile file
  let path = app_home_dir().join("profiles").join(&result.file);
  let file_data = result.data.as_bytes();
  File::create(path).unwrap().write(file_data).unwrap();

  // update `profiles.yaml`
  let mut profiles = read_profiles();
  let mut items = profiles.items.unwrap_or(vec![]);

  items.push(ProfileItem {
    name: Some(result.name),
    file: Some(result.file),
    mode: Some(format!("rule")),
    url: Some(url),
    selected: Some(vec![]),
    extra: Some(result.extra),
  });
  profiles.items = Some(items);
  save_profiles(&profiles)
}

/// Update the profile
/// and save to `profiles.yaml`
/// http request firstly
/// then acquire the lock of `profiles.yaml`
#[tauri::command]
pub async fn update_profile(index: usize, lock: State<'_, ProfileLock>) -> Result<(), String> {
  // get lock
  if lock.0.lock().is_err() {
    return Err(format!("can not get file lock"));
  }

  // update `profiles.yaml`
  let mut profiles = read_profiles();
  let mut items = profiles.items.unwrap_or(vec![]);

  if index >= items.len() {
    return Err(format!("the index out of bound"));
  }

  let url = match &items[index].url {
    Some(u) => u,
    None => return Err(format!("invalid url")),
  };

  let result = match fetch_profile(&url).await {
    Some(r) => r,
    None => {
      log::error!("failed to fetch profile from `{}`", url);
      return Err(format!("failed to fetch profile from `{}`", url));
    }
  };

  // update file
  let file_path = &items[index].file.as_ref().unwrap();
  let file_path = app_home_dir().join("profiles").join(file_path);
  let file_data = result.data.as_bytes();
  File::create(file_path).unwrap().write(file_data).unwrap();

  items[index].name = Some(result.name);
  items[index].extra = Some(result.extra);
  profiles.items = Some(items);
  save_profiles(&profiles)
}

/// get all profiles from `profiles.yaml`
/// do not acquire the lock of ProfileLock
#[tauri::command]
pub fn get_profiles() -> Result<ProfilesConfig, String> {
  Ok(read_profiles())
}

/// patch the profile config
#[tauri::command]
pub fn set_profiles(
  index: usize,
  profile: ProfileItem,
  lock: State<'_, ProfileLock>,
) -> Result<(), String> {
  // get lock
  if lock.0.lock().is_err() {
    return Err(format!("can not get file lock"));
  }

  let mut profiles = read_profiles();
  let mut items = profiles.items.unwrap_or(vec![]);

  if index >= items.len() {
    return Err(format!("the index out of bound"));
  }

  if profile.name.is_some() {
    items[index].name = profile.name;
  }
  if profile.file.is_some() {
    items[index].file = profile.file;
  }
  if profile.mode.is_some() {
    items[index].mode = profile.mode;
  }
  if profile.url.is_some() {
    items[index].url = profile.url;
  }
  if profile.selected.is_some() {
    items[index].selected = profile.selected;
  }
  if profile.extra.is_some() {
    items[index].extra = profile.extra;
  }

  profiles.items = Some(items);
  save_profiles(&profiles)
}

/// change the current profile
#[tauri::command]
pub async fn put_profiles(
  current: usize,
  lock: State<'_, ProfileLock>,
  clash_info: State<'_, ClashInfoState>,
) -> Result<(), String> {
  if lock.0.lock().is_err() {
    return Err(format!("can not get file lock"));
  }

  let clash_info = match clash_info.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err(format!("can not get clash info")),
  };

  let mut profiles = read_profiles();
  let items_len = match &profiles.items {
    Some(list) => list.len(),
    None => 0,
  };

  if current >= items_len {
    return Err(format!("the index out of bound"));
  }

  profiles.current = Some(current as u32);
  match save_profiles(&profiles) {
    Ok(_) => put_clash_profile(&clash_info).await,
    Err(err) => Err(err),
  }
}

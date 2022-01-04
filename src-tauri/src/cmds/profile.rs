use crate::{
  config::{ProfileItem, ProfilesConfig},
  events::state::{ClashInfoState, ProfilesState},
  utils::{clash, fetch},
};
use tauri::State;

/// get all profiles from `profiles.yaml`
/// do not acquire the lock of ProfileLock
#[tauri::command]
pub fn get_profiles(profiles: State<'_, ProfilesState>) -> Result<ProfilesConfig, String> {
  match profiles.0.lock() {
    Ok(profiles) => Ok(profiles.clone()),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// synchronize data irregularly
#[tauri::command]
pub fn sync_profiles(profiles: State<'_, ProfilesState>) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.sync_file(),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// Import the profile from url
/// and save to `profiles.yaml`
#[tauri::command]
pub async fn import_profile(url: String, profiles: State<'_, ProfilesState>) -> Result<(), String> {
  let result = match fetch::fetch_profile(&url).await {
    Some(r) => r,
    None => return Err(format!("failed to fetch profile from `{}`", url)),
  };

  match profiles.0.lock() {
    Ok(mut profiles) => profiles.import_from_url(url, result),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// Update the profile
/// and save to `profiles.yaml`
/// http request firstly
/// then acquire the lock of `profiles.yaml`
#[tauri::command]
pub async fn update_profile(
  index: usize,
  profiles: State<'_, ProfilesState>,
) -> Result<(), String> {
  // maybe we can get the url from the web app directly
  let url = {
    match profiles.0.lock() {
      Ok(mut profile) => {
        let items = profile.items.take().unwrap_or(vec![]);
        if index >= items.len() {
          return Err("the index out of bound".into());
        }
        let url = match &items[index].url {
          Some(u) => u.clone(),
          None => return Err("failed to update profile for `invalid url`".into()),
        };
        profile.items = Some(items);
        url
      }
      Err(_) => return Err("can not get profiles lock".into()),
    }
  };

  let result = match fetch::fetch_profile(&url).await {
    Some(r) => r,
    None => return Err(format!("failed to fetch profile from `{}`", url)),
  };

  match profiles.0.lock() {
    Ok(mut profiles) => profiles.update_item(index, result),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// change the current profile
#[tauri::command]
pub async fn select_profile(
  index: usize,
  profiles: State<'_, ProfilesState>,
  clash_info: State<'_, ClashInfoState>,
) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.put_current(index)?,
    Err(_) => return Err("can not get profiles lock".into()),
  };

  let arc = match clash_info.0.lock() {
    Ok(arc) => arc.clone(),
    _ => return Err("can not get clash info lock".into()),
  };

  clash::put_clash_profile(&arc).await
}

/// delete profile item
#[tauri::command]
pub fn delete_profile(index: usize, profiles: State<'_, ProfilesState>) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.delete_item(index),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

/// patch the profile config
#[tauri::command]
pub fn patch_profile(
  index: usize,
  profile: ProfileItem,
  profiles: State<'_, ProfilesState>,
) -> Result<(), String> {
  match profiles.0.lock() {
    Ok(mut profiles) => profiles.patch_item(index, profile),
    Err(_) => Err("can not get profiles lock".into()),
  }
}

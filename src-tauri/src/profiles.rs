extern crate reqwest;

use crate::config::verge::{ProfileData, ProfileUserInfo};
use crate::init::{app_home_dir, read_verge_config, save_verge_config};
use std::default::Default;
use std::fs::File;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

/// Todo: log
/// Import the Profile from url
/// save to the `verge.yaml` file
pub async fn import_profile(profile_url: &str) -> Result<(), reqwest::Error> {
  let resp = reqwest::get(profile_url).await?;
  let header = resp.headers().clone();
  let value = header
    .get("Subscription-Userinfo")
    .unwrap()
    .to_str()
    .unwrap();
  let value: Vec<&str> = value.clone().split(';').collect();

  let mut user_info = ProfileUserInfo::default();

  for each in value.iter() {
    let each = each.clone().trim();
    if let Some(val) = each.strip_prefix("upload=") {
      user_info.upload = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("download=") {
      user_info.download = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("total=") {
      user_info.total = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("expire=") {
      user_info.expire = val.parse().unwrap_or(0u64);
      continue;
    }
  }

  // save file
  let file_data = resp.text_with_charset("utf-8").await?;
  let cur_time = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();
  let file_name = format!("{}.yaml", cur_time);
  let file_path = app_home_dir().join("profiles").join(&file_name);

  File::create(file_path)
    .unwrap()
    .write(file_data.as_bytes())
    .unwrap();

  let mut verge = read_verge_config();

  let mut profiles = if verge.profiles.is_some() {
    verge.profiles.unwrap()
  } else {
    vec![]
  };

  let profile = ProfileData {
    name: Some(file_name.clone()),
    file: Some(file_name.clone()),
    mode: Some(String::from("rule")),
    url: Some(String::from(profile_url)),
    selected: Some(vec![]),
    user_info: Some(user_info),
  };

  let target_index = profiles
    .iter()
    .position(|x| x.name.is_some() && x.name.as_ref().unwrap().as_str() == file_name.as_str());

  if target_index.is_none() {
    profiles.push(profile)
  } else {
    profiles[target_index.unwrap()] = profile;
  }

  verge.profiles = Some(profiles);
  save_verge_config(&verge);

  Ok(())
}

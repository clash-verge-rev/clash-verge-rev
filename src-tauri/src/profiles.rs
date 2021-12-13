extern crate reqwest;

use crate::config::{read_profiles, save_profiles, ProfileExtra, ProfileItem};
use crate::init::app_home_dir;
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

  // parse the Subscription Userinfo
  let mut extra = ProfileExtra::default();
  for each in value.iter() {
    let each = each.clone().trim();
    if let Some(val) = each.strip_prefix("upload=") {
      extra.upload = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("download=") {
      extra.download = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("total=") {
      extra.total = val.parse().unwrap_or(0u64);
      continue;
    }
    if let Some(val) = each.strip_prefix("expire=") {
      extra.expire = val.parse().unwrap_or(0u64);
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

  // update profiles.yaml
  let mut profiles = read_profiles();
  let mut items = if profiles.items.is_some() {
    profiles.items.unwrap()
  } else {
    vec![]
  };

  let profile = ProfileItem {
    name: Some(file_name.clone()),
    file: Some(file_name.clone()),
    mode: Some(String::from("rule")),
    url: Some(String::from(profile_url)),
    selected: Some(vec![]),
    extra: Some(extra),
  };

  let target_index = items
    .iter()
    .position(|x| x.name.is_some() && x.name.as_ref().unwrap().as_str() == file_name.as_str());

  if target_index.is_none() {
    items.push(profile)
  } else {
    items[target_index.unwrap()] = profile;
  }

  profiles.items = Some(items);
  save_profiles(&profiles);

  Ok(())
}

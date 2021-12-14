extern crate reqwest;

use crate::config::{read_profiles, save_profiles, ProfileExtra, ProfileItem};
use crate::utils::app_home_dir;
use std::fs::File;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

/// parse the string
fn parse_string<'a>(target: &'a str, key: &'a str) -> Option<&'a str> {
  match target.find(key) {
    Some(idx) => {
      let idx = idx + key.len();
      let value = &target[idx..];
      match value.split(';').nth(0) {
        Some(value) => Some(value.trim()),
        None => Some(value.trim()),
      }
    }
    None => None,
  }
}

/// Todo: log
/// Import the Profile from url
/// save to the `verge.yaml` file
pub async fn import_profile(profile_url: &str) -> Result<(), reqwest::Error> {
  let resp = reqwest::get(profile_url).await?;
  let header = resp.headers().clone();

  // parse the Subscription Userinfo
  let extra = {
    let sub_info = header
      .get("Subscription-Userinfo")
      .unwrap()
      .to_str()
      .unwrap();

    ProfileExtra {
      upload: parse_string(sub_info, "upload=")
        .unwrap_or("0")
        .parse()
        .unwrap_or(0u64),
      download: parse_string(sub_info, "download=")
        .unwrap_or("0")
        .parse()
        .unwrap_or(0u64),
      total: parse_string(sub_info, "total=")
        .unwrap_or("0")
        .parse()
        .unwrap_or(0u64),
      expire: parse_string(sub_info, "expire=")
        .unwrap_or("0")
        .parse()
        .unwrap_or(0u64),
    }
  };

  // parse the file name
  let file_name = {
    let file_name = header.get("Content-Disposition").unwrap().to_str().unwrap();
    let file_name = parse_string(file_name, "filename=");

    match file_name {
      Some(f) => f.to_string(),
      None => {
        let cur_time = SystemTime::now()
          .duration_since(UNIX_EPOCH)
          .unwrap()
          .as_secs();
        format!("{}.yaml", cur_time)
      }
    }
  };

  // save file
  let file_data = resp.text_with_charset("utf-8").await?;
  let file_path = app_home_dir().join("profiles").join(&file_name);
  File::create(file_path)
    .unwrap()
    .write(file_data.as_bytes())
    .unwrap();

  // update profiles.yaml
  let mut profiles = read_profiles();
  let mut items = match profiles.items {
    Some(p) => p,
    None => vec![],
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

  match target_index {
    Some(idx) => items[idx] = profile,
    None => items.push(profile),
  };

  profiles.items = Some(items);
  save_profiles(&profiles);

  Ok(())
}

#[test]
fn test_parse_value() {
  let test_1 = "upload=111; download=2222; total=3333; expire=444";
  let test_2 = "attachment; filename=Clash.yaml";

  assert_eq!(parse_string(test_1, "upload="), Some("111"));
  assert_eq!(parse_string(test_1, "download="), Some("2222"));
  assert_eq!(parse_string(test_1, "total="), Some("3333"));
  assert_eq!(parse_string(test_1, "expire="), Some("444"));
  assert_eq!(parse_string(test_2, "filename="), Some("Clash.yaml"));

  assert_eq!(parse_string(test_1, "aaa="), None);
  assert_eq!(parse_string(test_1, "upload1="), None);
  assert_eq!(parse_string(test_1, "expire1="), None);
  assert_eq!(parse_string(test_2, "attachment="), None);
}

use crate::config::{ProfileExtra, ProfileResponse};
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

/// fetch and parse the profile
pub async fn fetch_profile(url: &str) -> Option<ProfileResponse> {
  let resp = match reqwest::get(url).await {
    Ok(res) => res,
    Err(_) => return None,
  };
  let header = resp.headers();

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

  // parse the `name` and `file`
  let (name, file) = {
    let now = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_secs();
    let file = format!("{}.yaml", now);
    let name = header.get("Content-Disposition").unwrap().to_str().unwrap();
    let name = parse_string(name, "filename=");

    match name {
      Some(f) => (f.to_string(), file),
      None => (file.clone(), file),
    }
  };

  // get the data
  let data = match resp.text_with_charset("utf-8").await {
    Ok(d) => d,
    Err(_) => return None,
  };

  Some(ProfileResponse {
    file,
    name,
    data,
    extra,
  })
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

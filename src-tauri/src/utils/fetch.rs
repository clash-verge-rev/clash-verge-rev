use crate::core::{ProfileExtra, ProfileResponse};
use std::{
  str::FromStr,
  time::{SystemTime, UNIX_EPOCH},
};

/// parse the string
fn parse_string<T: FromStr>(target: &str, key: &str) -> Option<T> {
  match target.find(key) {
    Some(idx) => {
      let idx = idx + key.len();
      let value = &target[idx..];
      match match value.split(';').nth(0) {
        Some(value) => value.trim().parse(),
        None => value.trim().parse(),
      } {
        Ok(r) => Some(r),
        Err(_) => None,
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
    let sub_info = match header.get("Subscription-Userinfo") {
      Some(value) => value.to_str().unwrap_or(""),
      None => "",
    };

    ProfileExtra {
      upload: parse_string(sub_info, "upload=").unwrap_or(0),
      download: parse_string(sub_info, "download=").unwrap_or(0),
      total: parse_string(sub_info, "total=").unwrap_or(0),
      expire: parse_string(sub_info, "expire=").unwrap_or(0),
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
    let name = parse_string::<String>(name, "filename=");

    match name {
      Some(f) => (f, file),
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

  assert_eq!(parse_string::<usize>(test_1, "upload=").unwrap(), 111);
  assert_eq!(parse_string::<usize>(test_1, "download=").unwrap(), 2222);
  assert_eq!(parse_string::<usize>(test_1, "total=").unwrap(), 3333);
  assert_eq!(parse_string::<usize>(test_1, "expire=").unwrap(), 444);
  assert_eq!(
    parse_string::<String>(test_2, "filename=").unwrap(),
    format!("Clash.yaml")
  );

  assert_eq!(parse_string::<usize>(test_1, "aaa="), None);
  assert_eq!(parse_string::<usize>(test_1, "upload1="), None);
  assert_eq!(parse_string::<usize>(test_1, "expire1="), None);
  assert_eq!(parse_string::<usize>(test_2, "attachment="), None);
}

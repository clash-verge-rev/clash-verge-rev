use serde::{Deserialize, Serialize};

/// Define the `profiles.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ProfilesConfig {
  /// current profile's name
  pub current: Option<usize>,

  /// profile list
  pub items: Option<Vec<ProfileItem>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ProfileItem {
  /// profile name
  pub name: Option<String>,
  /// profile file
  pub file: Option<String>,
  /// current mode
  pub mode: Option<String>,
  /// source url
  pub url: Option<String>,
  /// selected infomation
  pub selected: Option<Vec<ProfileSelected>>,
  /// user info
  pub extra: Option<ProfileExtra>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ProfileSelected {
  pub name: Option<String>,
  pub now: Option<String>,
}

#[derive(Default, Debug, Clone, Copy, Deserialize, Serialize)]
pub struct ProfileExtra {
  pub upload: usize,
  pub download: usize,
  pub total: usize,
  pub expire: usize,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
/// the result from url
pub struct ProfileResponse {
  pub name: String,
  pub file: String,
  pub data: String,
  pub extra: ProfileExtra,
}

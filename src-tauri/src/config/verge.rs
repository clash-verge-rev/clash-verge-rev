use serde::{Deserialize, Serialize};

/// Define the verge.yaml's schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeConfig {
  /// current profile's name
  pub current: Option<u32>,

  /// profile list
  pub profiles: Option<Vec<ProfileData>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ProfileData {
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
  pub user_info: Option<ProfileUserInfo>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ProfileSelected {
  pub name: Option<String>,
  pub now: Option<String>,
}

#[derive(Default, Debug, Clone, Copy, Deserialize, Serialize)]
pub struct ProfileUserInfo {
  pub upload: u64,
  pub download: u64,
  pub total: u64,
  pub expire: u64,
}

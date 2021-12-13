use serde::{de::DeserializeOwned, Serialize};
use std::{fs, path::PathBuf};

use super::profiles::ProfilesConfig;
use crate::init::app_home_dir;

/// read data from yaml as struct T
pub fn read_yaml<T: DeserializeOwned>(path: PathBuf) -> T {
  let yaml_str = fs::read_to_string(path).unwrap();
  serde_yaml::from_str::<T>(&yaml_str).unwrap()
}

/// - save the data to the file
/// - can set `prefix` string to add some comments
pub fn save_yaml<T: Serialize>(
  path: PathBuf,
  data: &T,
  prefix: Option<&str>,
) -> Result<(), String> {
  if let Ok(data_str) = serde_yaml::to_string(data) {
    let yaml_str = if prefix.is_some() {
      prefix.unwrap().to_string() + &data_str
    } else {
      data_str
    };

    if fs::write(path.clone(), yaml_str.as_bytes()).is_err() {
      Err(format!("can not save file `{:?}`", path))
    } else {
      Ok(())
    }
  } else {
    Err(String::from("can not convert the data to yaml"))
  }
}

// /// Get Clash Core Config
// pub fn read_clash() -> Mapping {
//   read_yaml::<Mapping>(app_home_dir().join("config.yaml"))
// }

// /// Get Verge App Config
// pub fn read_verge() -> ProfilesConfig {
//   read_from_yaml::<ProfilesConfig>(app_home_dir().join("verge.yaml"))
// }

// /// Save Verge App Config
// pub fn save_verge(verge_config: &ProfilesConfig) {
//   let yaml_path = app_home_dir().join("verge.yaml");
//   let yaml_str = serde_yaml::to_string(&verge_config).unwrap();
//   let yaml_str = String::from("# Config File for Clash Verge\n\n") + &yaml_str;
//   fs::write(yaml_path, yaml_str.as_bytes()).unwrap();
// }

/// Get Profiles Config
pub fn read_profiles() -> ProfilesConfig {
  read_yaml::<ProfilesConfig>(app_home_dir().join("profiles.yaml"))
}

/// Save Verge App Config
pub fn save_profiles(profiles: &ProfilesConfig) {
  save_yaml(
    app_home_dir().join("profiles.yaml"),
    profiles,
    Some("# Profiles Config for Clash Verge\n\n"),
  )
  .unwrap();
}

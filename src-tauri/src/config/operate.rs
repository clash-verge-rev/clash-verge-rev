use serde::{de::DeserializeOwned, Serialize};
use serde_yaml::{Mapping, Value};
use std::{fs, path::PathBuf};

use super::{profiles::ProfilesConfig, ClashController};
use crate::utils::app_home_dir;

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

/// Get Clash Core Config
pub fn read_clash() -> Mapping {
  read_yaml::<Mapping>(app_home_dir().join("config.yaml"))
}

/// Get infomation of the clash's `external-controller` and `secret`
pub fn read_clash_controller() -> ClashController {
  let config = read_clash();

  let key_port_1 = Value::String("port".to_string());
  let key_port_2 = Value::String("mixed-port".to_string());
  let key_server = Value::String("external-controller".to_string());
  let key_secret = Value::String("secret".to_string());

  let port = match config.get(&key_port_1) {
    Some(value) => match value {
      Value::String(val_str) => Some(val_str.clone()),
      Value::Number(val_num) => Some(val_num.to_string()),
      _ => None,
    },
    _ => None,
  };
  let port = match port {
    Some(_) => port,
    None => match config.get(&key_port_2) {
      Some(value) => match value {
        Value::String(val_str) => Some(val_str.clone()),
        Value::Number(val_num) => Some(val_num.to_string()),
        _ => None,
      },
      _ => None,
    },
  };

  let server = match config.get(&key_server) {
    Some(value) => match value {
      Value::String(val_str) => Some(val_str.clone()),
      _ => None,
    },
    _ => None,
  };
  let secret = match config.get(&key_secret) {
    Some(value) => match value {
      Value::String(val_str) => Some(val_str.clone()),
      Value::Bool(val_bool) => Some(val_bool.to_string()),
      Value::Number(val_num) => Some(val_num.to_string()),
      _ => None,
    },
    _ => None,
  };

  ClashController {
    port,
    server,
    secret,
  }
}

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

#[test]
fn test_print_config() {
  println!("{:?}", read_clash_controller());
}

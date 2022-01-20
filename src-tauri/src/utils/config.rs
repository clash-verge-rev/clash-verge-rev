use serde::{de::DeserializeOwned, Serialize};
use std::{fs, path::PathBuf};

/// read data from yaml as struct T
pub fn read_yaml<T: DeserializeOwned + Default>(path: PathBuf) -> T {
  let yaml_str = fs::read_to_string(path).unwrap_or("".into());
  serde_yaml::from_str::<T>(&yaml_str).unwrap_or(T::default())
}

/// - save the data to the file
/// - can set `prefix` string to add some comments
pub fn save_yaml<T: Serialize>(
  path: PathBuf,
  data: &T,
  prefix: Option<&str>,
) -> Result<(), String> {
  match serde_yaml::to_string(data) {
    Ok(data_str) => {
      let yaml_str = match prefix {
        Some(prefix) => format!("{}{}", prefix, data_str),
        None => data_str,
      };

      let path_str = path.as_os_str().to_string_lossy().to_string();
      match fs::write(path, yaml_str.as_bytes()) {
        Ok(_) => Ok(()),
        Err(_) => Err(format!("can not save file `{}`", path_str)),
      }
    }
    Err(_) => Err("can not convert the data to yaml".into()),
  }
}

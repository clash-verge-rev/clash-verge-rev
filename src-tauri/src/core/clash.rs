use crate::utils::{config, dirs};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashInfo {
  /// clash sidecar status
  pub status: String,

  /// clash core port
  pub port: Option<String>,

  /// same as `external-controller`
  pub server: Option<String>,

  /// clash secret
  pub secret: Option<String>,
}

impl ClashInfo {
  /// parse the clash's config.yaml
  /// get some information
  pub fn from(config: &Mapping) -> ClashInfo {
    let key_port_1 = Value::from("mixed-port");
    let key_port_2 = Value::from("port");
    let key_server = Value::from("external-controller");
    let key_secret = Value::from("secret");

    let mut status: u32 = 0;

    let port = match config.get(&key_port_1) {
      Some(value) => match value {
        Value::String(val_str) => Some(val_str.clone()),
        Value::Number(val_num) => Some(val_num.to_string()),
        _ => {
          status |= 0b1;
          None
        }
      },
      _ => {
        status |= 0b10;
        None
      }
    };
    let port = match port {
      Some(_) => port,
      None => match config.get(&key_port_2) {
        Some(value) => match value {
          Value::String(val_str) => Some(val_str.clone()),
          Value::Number(val_num) => Some(val_num.to_string()),
          _ => {
            status |= 0b100;
            None
          }
        },
        _ => {
          status |= 0b1000;
          None
        }
      },
    };

    // `external-controller` could be
    // "127.0.0.1:9090" or ":9090"
    let server = match config.get(&key_server) {
      Some(value) => match value.as_str() {
        Some(val_str) => {
          if val_str.starts_with(":") {
            Some(format!("127.0.0.1{val_str}"))
          } else {
            Some(val_str.into())
          }
        }
        None => {
          status |= 0b10000;
          None
        }
      },
      None => {
        status |= 0b100000;
        None
      }
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

    ClashInfo {
      status: format!("{status}"),
      port,
      server,
      secret,
    }
  }
}

pub struct Clash {
  /// maintain the clash config
  pub config: Mapping,

  /// some info
  pub info: ClashInfo,
}

impl Clash {
  pub fn new() -> Clash {
    let config = Clash::read_config();
    let info = ClashInfo::from(&config);

    Clash { config, info }
  }

  /// get clash config
  pub fn read_config() -> Mapping {
    config::read_yaml::<Mapping>(dirs::clash_path())
  }

  /// save the clash config
  pub fn save_config(&self) -> Result<()> {
    config::save_yaml(
      dirs::clash_path(),
      &self.config,
      Some("# Default Config For Clash Core\n\n"),
    )
  }

  /// patch update the clash config
  /// if the port is changed then return true
  pub fn patch_config(&mut self, patch: Mapping) -> Result<()> {
    let port_key = Value::from("mixed-port");
    let server_key = Value::from("external-controller");
    let secret_key = Value::from("secret");

    let change_info = patch.contains_key(&port_key)
      || patch.contains_key(&server_key)
      || patch.contains_key(&secret_key);

    for (key, value) in patch.into_iter() {
      self.config.insert(key, value);
    }

    if change_info {
      self.info = ClashInfo::from(&self.config);
    }

    self.save_config()
  }
}

impl Default for Clash {
  fn default() -> Self {
    Clash::new()
  }
}

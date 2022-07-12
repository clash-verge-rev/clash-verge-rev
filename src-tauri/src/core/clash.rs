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
    let key_port_1 = Value::from("port");
    let key_port_2 = Value::from("mixed-port");
    let key_server = Value::from("external-controller");
    let key_secret = Value::from("secret");

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

    // `external-controller` could be
    // "127.0.0.1:9090" or ":9090"
    let server = match config.get(&key_server) {
      Some(value) => {
        let val_str = value.as_str().unwrap_or("");

        if val_str.starts_with(":") {
          Some(format!("127.0.0.1{val_str}"))
        } else {
          Some(val_str.into())
        }
      }
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

    ClashInfo {
      status: "init".into(),
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
  pub fn patch_config(&mut self, patch: Mapping) -> Result<(bool, bool)> {
    let port_key = Value::from("mixed-port");
    let server_key = Value::from("external-controller");
    let secret_key = Value::from("secret");
    let mode_key = Value::from("mode");

    let mut change_port = false;
    let mut change_info = false;
    let mut change_mode = false;

    for (key, value) in patch.into_iter() {
      if key == port_key {
        change_port = true;
      }

      if key == mode_key {
        change_mode = true;
      }

      if key == port_key || key == server_key || key == secret_key || key == mode_key {
        change_info = true;
      }

      self.config.insert(key, value);
    }

    if change_info {
      self.info = ClashInfo::from(&self.config);
    }

    self.save_config()?;

    Ok((change_port, change_mode))
  }

  /// revise the `tun` and `dns` config
  pub fn _tun_mode(mut config: Mapping, enable: bool) -> Mapping {
    macro_rules! revise {
      ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
      };
    }

    // if key not exists then append value
    macro_rules! append {
      ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        if !$map.contains_key(&ret_key) {
          $map.insert(ret_key, Value::from($val));
        }
      };
    }

    // tun config
    let tun_val = config.get(&Value::from("tun"));
    let mut new_tun = Mapping::new();

    if tun_val.is_some() && tun_val.as_ref().unwrap().is_mapping() {
      new_tun = tun_val.as_ref().unwrap().as_mapping().unwrap().clone();
    }

    revise!(new_tun, "enable", enable);

    if enable {
      append!(new_tun, "stack", "gvisor");
      append!(new_tun, "dns-hijack", vec!["198.18.0.2:53"]);
      append!(new_tun, "auto-route", true);
      append!(new_tun, "auto-detect-interface", true);
    }

    revise!(config, "tun", new_tun);

    if enable {
      // dns config
      let dns_val = config.get(&Value::from("dns"));
      let mut new_dns = Mapping::new();

      if dns_val.is_some() && dns_val.as_ref().unwrap().is_mapping() {
        new_dns = dns_val.as_ref().unwrap().as_mapping().unwrap().clone();
      }
      revise!(new_dns, "enable", enable);

      // 借鉴cfw的默认配置
      append!(new_dns, "enhanced-mode", "fake-ip");
      append!(
        new_dns,
        "nameserver",
        vec!["114.114.114.114", "223.5.5.5", "8.8.8.8"]
      );
      append!(new_dns, "fallback", vec![] as Vec<&str>);

      #[cfg(target_os = "windows")]
      append!(
        new_dns,
        "fake-ip-filter",
        vec![
          "dns.msftncsi.com",
          "www.msftncsi.com",
          "www.msftconnecttest.com"
        ]
      );

      revise!(config, "dns", new_dns);
    }

    config
  }

  /// only 5 default fields available (clash config fields)
  /// convert to lowercase
  pub fn strict_filter(config: Mapping) -> Mapping {
    // Only the following fields are allowed:
    // proxies/proxy-providers/proxy-groups/rule-providers/rules
    let valid_keys = vec![
      "proxies",
      "proxy-providers",
      "proxy-groups",
      "rules",
      "rule-providers",
    ];

    let mut new_config = Mapping::new();

    for (key, value) in config.into_iter() {
      key.as_str().map(|key_str| {
        // change to lowercase
        let mut key_str = String::from(key_str);
        key_str.make_ascii_lowercase();

        // filter
        if valid_keys.contains(&&*key_str) {
          new_config.insert(Value::String(key_str), value);
        }
      });
    }

    new_config
  }

  /// more clash config fields available
  /// convert to lowercase
  pub fn loose_filter(config: Mapping) -> Mapping {
    // all of these can not be revised by script or merge
    // http/https/socks port should be under control
    let not_allow = vec![
      "port",
      "socks-port",
      "mixed-port",
      "allow-lan",
      "mode",
      "external-controller",
      "secret",
      "log-level",
    ];

    let mut new_config = Mapping::new();

    for (key, value) in config.into_iter() {
      key.as_str().map(|key_str| {
        // change to lowercase
        let mut key_str = String::from(key_str);
        key_str.make_ascii_lowercase();

        // filter
        if !not_allow.contains(&&*key_str) {
          new_config.insert(Value::String(key_str), value);
        }
      });
    }

    new_config
  }
}

impl Default for Clash {
  fn default() -> Self {
    Clash::new()
  }
}

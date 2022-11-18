use crate::utils::{config, dirs};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

#[derive(Default, Debug, Clone)]
pub struct IClashTemp(pub Mapping);

impl IClashTemp {
    pub fn new() -> Self {
        match dirs::clash_path().and_then(|path| config::read_merge_mapping(&path)) {
            Ok(map) => Self(map),
            Err(err) => {
                log::error!(target: "app", "{err}");
                Self::template()
            }
        }
    }

    pub fn template() -> Self {
        let mut map = Mapping::new();

        map.insert("mixed-port".into(), 7892.into());
        map.insert("log-level".into(), "info".into());
        map.insert("allow-lan".into(), false.into());
        map.insert("mode".into(), "rule".into());
        map.insert("external-controller".into(), "127.0.0.1:9090".into());
        map.insert("secret".into(), "".into());

        Self(map)
    }

    pub fn patch_config(&mut self, patch: Mapping) {
        for (key, value) in patch.into_iter() {
            self.0.insert(key, value);
        }
    }

    pub fn save_config(&self) -> Result<()> {
        config::save_yaml(
            dirs::clash_path()?,
            &self.0,
            Some("# Default Config For ClashN Core\n\n"),
        )
    }

    pub fn get_info(&self) -> Result<ClashInfoN> {
        Ok(ClashInfoN::from(&self.0))
    }
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashInfoN {
    /// clash sidecar status
    pub status: String,
    /// clash core port
    pub port: Option<String>,
    /// same as `external-controller`
    pub server: Option<String>,
    /// clash secret
    pub secret: Option<String>,
}

impl ClashInfoN {
    /// parse the clash's config.yaml
    /// get some information
    pub fn from(config: &Mapping) -> ClashInfoN {
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
                    } else if val_str.starts_with("0.0.0.0:") {
                        Some(format!("127.0.0.1:{}", &val_str[8..]))
                    } else if val_str.starts_with("[::]:") {
                        Some(format!("127.0.0.1:{}", &val_str[5..]))
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

        ClashInfoN {
            status: format!("{status}"),
            port,
            server,
            secret,
        }
    }
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClash {
    pub mixed_port: Option<u16>,
    pub allow_lan: Option<bool>,
    pub log_level: Option<String>,
    pub ipv6: Option<bool>,
    pub mode: Option<String>,
    pub external_controller: Option<String>,
    pub secret: Option<String>,
    pub dns: Option<IClashDNS>,
    pub tun: Option<IClashTUN>,
    pub interface_name: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashTUN {
    pub enable: Option<bool>,
    pub stack: Option<String>,
    pub auto_route: Option<bool>,
    pub auto_detect_interface: Option<bool>,
    pub dns_hijack: Option<Vec<String>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashDNS {
    pub enable: Option<bool>,
    pub listen: Option<String>,
    pub default_nameserver: Option<Vec<String>>,
    pub enhanced_mode: Option<String>,
    pub fake_ip_range: Option<String>,
    pub use_hosts: Option<bool>,
    pub fake_ip_filter: Option<Vec<String>>,
    pub nameserver: Option<Vec<String>>,
    pub fallback: Option<Vec<String>>,
    pub fallback_filter: Option<IClashFallbackFilter>,
    pub nameserver_policy: Option<Vec<String>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashFallbackFilter {
    pub geoip: Option<bool>,
    pub geoip_code: Option<String>,
    pub ipcidr: Option<Vec<String>>,
    pub domain: Option<Vec<String>>,
}

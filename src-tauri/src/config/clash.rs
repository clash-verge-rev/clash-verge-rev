use crate::utils::{config, dirs};
use anyhow::Result;
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::sync::Arc;

#[derive(Debug)]
pub struct ClashN {
    /// maintain the clash config
    pub config: Arc<Mutex<Mapping>>,
    /// some info
    pub info: Arc<Mutex<ClashInfoN>>,
}

impl ClashN {
    pub fn global() -> &'static ClashN {
        static DATA: OnceCell<ClashN> = OnceCell::new();

        DATA.get_or_init(|| {
            let config = ClashN::read_config();
            let info = ClashInfoN::from(&config);

            ClashN {
                config: Arc::new(Mutex::new(config)),
                info: Arc::new(Mutex::new(info)),
            }
        })
    }

    /// get clash config
    pub fn read_config() -> Mapping {
        config::read_merge_mapping(dirs::clash_path())
    }

    /// save the clash config
    pub fn save_config(&self) -> Result<()> {
        let config = self.config.lock();

        config::save_yaml(
            dirs::clash_path(),
            &*config,
            Some("# Default Config For ClashN Core\n\n"),
        )
    }

    /// 返回旧值
    pub fn patch_info(&self, info: ClashInfoN) -> Result<ClashInfoN> {
        let mut old_info = self.info.lock();
        let old = (*old_info).to_owned();
        *old_info = info;
        Ok(old)
    }

    /// patch update the clash config
    /// if the port is changed then return true
    pub fn patch_config(&self, patch: Mapping) -> Result<()> {
        let mut config = self.config.lock();

        let port_key = Value::from("mixed-port");
        let server_key = Value::from("external-controller");
        let secret_key = Value::from("secret");

        let change_info = patch.contains_key(&port_key)
            || patch.contains_key(&server_key)
            || patch.contains_key(&secret_key);

        for (key, value) in patch.into_iter() {
            config.insert(key, value);
        }

        if change_info {
            let mut info = self.info.lock();
            *info = ClashInfoN::from(&*config);
        }

        self.save_config()
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

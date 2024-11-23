use crate::enhance::field::use_keys;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::HashMap;
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    // 记录在订阅中（包括merge和script生成的）出现过的keys
    // 这些keys不一定都生效
    pub exists_keys: Vec<String>,
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
}

impl IRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    // 这里只更改 allow-lan | ipv6 | log-level | tun
    pub fn patch_config(&mut self, patch: Mapping) {
        if let Some(config) = self.config.as_mut() {
            ["allow-lan", "ipv6", "log-level", "unified-delay"]
                .into_iter()
                .for_each(|key| {
                    if let Some(value) = patch.get(key).to_owned() {
                        config.insert(key.into(), value.clone());
                    }
                });

            let patch_tun = patch.get("tun");
            if patch_tun.is_some() {
                let tun = config.get("tun");
                let mut tun = tun.map_or(Mapping::new(), |val| {
                    val.as_mapping().cloned().unwrap_or(Mapping::new())
                });
                let patch_tun = patch_tun.map_or(Mapping::new(), |val| {
                    val.as_mapping().cloned().unwrap_or(Mapping::new())
                });
                use_keys(&patch_tun).into_iter().for_each(|key| {
                    if let Some(value) = patch_tun.get(&key).to_owned() {
                        tun.insert(key.into(), value.clone());
                    }
                });

                config.insert("tun".into(), Value::from(tun));
            }
        }
    }
}

use crate::enhance::LogMessage;

use super::CLASH_BASIC_CONFIG;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::HashMap;

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    // 记录在订阅中（包括merge和script生成的）出现过的keys
    // 这些keys不一定都生效
    pub exists_keys: Vec<String>,
    pub chain_logs: HashMap<String, Vec<LogMessage>>,
}

impl IRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    // 这里只更改 clash 基本配置
    pub fn patch_config(&mut self, patch: Mapping) {
        for key in CLASH_BASIC_CONFIG {
            if let Some(value) = patch.get(key) {
                match value {
                    Value::Mapping(val_map) => {
                        if let Some(config) = self.config.as_mut() {
                            let mut patch_val_map = config.get(key).map_or(Mapping::new(), |val| {
                                val.as_mapping().cloned().unwrap_or(Mapping::new())
                            });
                            for (k, v) in val_map.into_iter() {
                                patch_val_map.insert(k.clone(), v.clone());
                            }
                            config.insert(key.into(), patch_val_map.clone().into());
                        }
                    }
                    _ => {
                        if let Some(config) = self.config.as_mut() {
                            config.insert(key.into(), value.clone());
                        }
                    }
                }
            }
        }
    }
}

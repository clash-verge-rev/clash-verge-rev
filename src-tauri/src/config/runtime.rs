use super::CLASH_BASIC_CONFIG;
use crate::enhance::LogMessage;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::HashMap;

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct IRuntime {
    pub config: Option<Mapping>,
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
                    Value::Mapping(patch_val) => {
                        if let Some(config) = self.config.as_mut() {
                            let mut patch_result = config
                                .get(key)
                                .map_or(Mapping::new(), |val| val.as_mapping().cloned().unwrap_or_default());
                            for (k, v) in patch_val.clone().into_iter() {
                                patch_result.insert(k, v);
                            }
                            config.insert(key.into(), patch_result.into());
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

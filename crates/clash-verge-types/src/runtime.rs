use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::HashMap;

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    // 记录在订阅中（包括merge和script生成的）出现过的keys
    // 这些keys不一定都生效
    // TODO 或许我们可以用  hashset 来存储以提升查询效率
    pub exists_keys: Vec<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
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
                let mut tun: Mapping = tun.map_or_else(Mapping::new, |val| {
                    val.as_mapping().cloned().unwrap_or_else(Mapping::new)
                });
                let patch_tun = patch_tun.map_or_else(Mapping::new, |val| {
                    val.as_mapping().cloned().unwrap_or_else(Mapping::new)
                });
                use_keys(&patch_tun).into_iter().for_each(|key| {
                    if let Some(value) = patch_tun.get(key.as_str()) {
                        tun.insert(Value::from(key.as_str()), value.clone());
                    }
                });

                config.insert("tun".into(), Value::from(tun));
            }
        }
    }

    // 传入none 为删除
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>) {
        if let Some(config) = self.config.as_mut() {
            if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
                proxies.iter_mut().for_each(|proxy| {
                    if let Some(proxy) = proxy.as_mapping_mut()
                        && proxy.get("dialer-proxy").is_some()
                    {
                        proxy.remove("dialer-proxy");
                    }
                });
            }

            if let Some(Value::Sequence(dialer_proxies)) = proxy_chain_config
                && let Some(Value::Sequence(proxies)) = config.get_mut("proxies")
            {
                for (i, dialer_proxy) in dialer_proxies.iter().enumerate() {
                    if let Some(Value::Mapping(proxy)) = proxies
                        .iter_mut()
                        .find(|proxy| proxy.get("name") == Some(dialer_proxy))
                        && i != 0
                        && let Some(dialer_proxy) = dialer_proxies.get(i - 1)
                    {
                        proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
                    }
                }
            }
        }
    }
}

// TODO 完整迁移 enhance 行为后移除
fn use_keys(config: &Mapping) -> Vec<String> {
    config
        .iter()
        .filter_map(|(key, _)| key.as_str())
        .map(|s: &str| {
            let mut s: String = s.into();
            s.make_ascii_lowercase();
            s
        })
        .collect()
}

use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};

use crate::enhance::field::use_keys;

const PATCH_CONFIG_INNER: [&str; 5] = ["allow-lan", "ipv6", "log-level", "unified-delay", "tunnels"];

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    // 记录在订阅中（包括merge和script生成的）出现过的keys
    // 这些keys不一定都生效
    pub exists_keys: HashSet<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
    pub proxy_chain_injected: HashSet<String>,
    pub proxy_chain_group_injected: HashSet<(String, String)>,
}

impl IRuntime {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    // 这里只更改 allow-lan | ipv6 | log-level | tun | tunnels
    #[inline]
    pub fn patch_config(&mut self, patch: &Mapping) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        for key in PATCH_CONFIG_INNER.iter() {
            if let Some(value) = patch.get(key) {
                config.insert((*key).into(), value.clone());
            }
        }

        let Some(patch_tun) = patch.get("tun") else {
            return;
        };

        let tun_key = Value::from("tun");
        if !matches!(config.get(&tun_key), Some(Value::Mapping(_))) {
            config.insert(tun_key.clone(), Value::Mapping(Mapping::new()));
        }

        if let (Some(patch_tun_mapping), Some(Value::Mapping(tun))) = (patch_tun.as_mapping(), config.get_mut(&tun_key))
        {
            for key in use_keys(patch_tun_mapping) {
                if let Some(value) = patch_tun_mapping.get(key.as_str()) {
                    tun.insert(Value::from(key.as_str()), value.clone());
                }
            }
        }
    }

    /// 更新链式代理配置
    ///
    /// 该函数更新 `proxies` 和 `proxy-groups` 配置，并处理链式代理的修改或(传入 None )删除。
    ///
    /// 配置示例：
    ///
    /// ```json
    /// {
    ///     "proxies": [
    ///         {
    ///             "name": "入口节点",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx"
    ///         },
    ///         {
    ///             "name": "hop_node_1_xxxx",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx",
    ///             "dialer-proxy": "入口节点"
    ///         },
    ///         {
    ///             "name": "出口节点",
    ///             "type": "xxx",
    ///             "server": "xxx",
    ///             "port": "xxx",
    ///             "ports": "xxx",
    ///             "password": "xxx",
    ///             "skip-cert-verify": "xxx",
    ///             "dialer-proxy": "hop_node_1_xxxx"
    ///         }
    ///     ],
    ///     "proxy-groups": [
    ///         {
    ///             "name": "proxy_chain",
    ///             "type": "select",
    ///             "proxies": ["出口节点"]
    ///         }
    ///     ]
    /// }
    /// ```
    #[inline]
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Vec<Value>>, target_group: Option<String>) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        if !self.proxy_chain_group_injected.is_empty()
            && let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups")
        {
            for (group_name, proxy_name) in &self.proxy_chain_group_injected {
                if let Some(Value::Mapping(group)) = groups
                    .iter_mut()
                    .find(|group| group.get("name").and_then(Value::as_str) == Some(group_name.as_str()))
                    && let Some(Value::Sequence(members)) = group.get_mut("proxies")
                {
                    members.retain(|member| member.as_str() != Some(proxy_name.as_str()));
                }
            }
        }
        self.proxy_chain_group_injected.clear();

        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            if !self.proxy_chain_injected.is_empty() {
                proxies.retain(|proxy| {
                    proxy
                        .get("name")
                        .and_then(Value::as_str)
                        .is_none_or(|name| !self.proxy_chain_injected.contains(name))
                });
            }

            proxies.iter_mut().for_each(|proxy| {
                if let Some(proxy) = proxy.as_mapping_mut()
                    && proxy.get("dialer-proxy").is_some()
                {
                    proxy.remove("dialer-proxy");
                }
            });
        }
        self.proxy_chain_injected.clear();

        let Some(chain_proxies) = proxy_chain_config else {
            return;
        };

        let proxies_key = Value::from("proxies");
        if !matches!(config.get(&proxies_key), Some(Value::Sequence(_))) {
            config.insert(proxies_key.clone(), Value::Sequence(Vec::new()));
        }

        let Some(Value::Sequence(proxies)) = config.get_mut(&proxies_key) else {
            return;
        };

        let mut existing_names = proxies
            .iter()
            .filter_map(|proxy| proxy.get("name").and_then(Value::as_str).map(str::to_owned))
            .collect::<HashSet<_>>();

        let chain_names = chain_proxies
            .iter()
            .filter_map(|proxy| proxy.get("name").and_then(Value::as_str).map(Value::from))
            .collect::<Vec<_>>();

        for proxy in chain_proxies {
            let Some(name) = proxy.get("name").and_then(Value::as_str).map(str::to_owned) else {
                continue;
            };
            if existing_names.insert(name.clone()) {
                proxies.push(proxy);
                self.proxy_chain_injected.insert(name.into());
            }
        }

        for (i, proxy_name) in chain_names.iter().enumerate() {
            if i == 0 {
                continue;
            }
            if let Some(Value::Mapping(proxy)) = proxies.iter_mut().find(|proxy| proxy.get("name") == Some(proxy_name))
                && let Some(dialer_proxy) = chain_names.get(i - 1)
            {
                proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
            }
        }

        let Some(target_group) = target_group.filter(|group| group != "GLOBAL") else {
            return;
        };
        let Some(exit_name) = chain_names.last().and_then(Value::as_str) else {
            return;
        };
        let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") else {
            return;
        };
        let Some(Value::Mapping(group)) = groups
            .iter_mut()
            .find(|group| group.get("name").and_then(Value::as_str) == Some(target_group.as_str()))
        else {
            return;
        };
        let members_key = Value::from("proxies");
        if !matches!(group.get(&members_key), Some(Value::Sequence(_))) {
            group.insert(members_key.clone(), Value::Sequence(Vec::new()));
        }
        let Some(Value::Sequence(members)) = group.get_mut(&members_key) else {
            return;
        };
        if !members.iter().any(|member| member.as_str() == Some(exit_name)) {
            members.push(Value::from(exit_name));
            self.proxy_chain_group_injected.insert((target_group, exit_name.into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IRuntime;
    use serde_yaml_ng::{Mapping, Value};

    fn proxy(name: &str) -> Value {
        serde_yaml_ng::from_str(&format!("name: {name}\ntype: ss\nserver: example.com\nport: 1\n")).unwrap()
    }

    fn runtime_with_proxies(proxies: Vec<Value>) -> IRuntime {
        let mut config = Mapping::new();
        config.insert(Value::from("proxies"), Value::Sequence(proxies));
        IRuntime {
            config: Some(config),
            ..Default::default()
        }
    }

    #[test]
    fn proxy_chain_adds_dialer_proxy_to_later_nodes() {
        let mut runtime = runtime_with_proxies(vec![proxy("A"), proxy("B")]);

        runtime.update_proxy_chain_config(Some(vec![proxy("A"), proxy("B")]), None);

        let proxies = runtime
            .config
            .as_ref()
            .unwrap()
            .get("proxies")
            .unwrap()
            .as_sequence()
            .unwrap();
        let b = proxies
            .iter()
            .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some("B"))
            .unwrap();
        assert_eq!(b.get("dialer-proxy").and_then(Value::as_str), Some("A"));
    }

    #[test]
    fn proxy_chain_injects_missing_profile_proxy() {
        let mut runtime = runtime_with_proxies(vec![proxy("B")]);

        runtime.update_proxy_chain_config(Some(vec![proxy("A"), proxy("B")]), None);

        let proxies = runtime
            .config
            .as_ref()
            .unwrap()
            .get("proxies")
            .unwrap()
            .as_sequence()
            .unwrap();
        assert!(
            proxies
                .iter()
                .any(|proxy| proxy.get("name").and_then(Value::as_str) == Some("A"))
        );
        assert!(runtime.proxy_chain_injected.contains("A"));
    }

    #[test]
    fn proxy_chain_clear_removes_injected_and_dialer_proxy() {
        let mut runtime = runtime_with_proxies(vec![proxy("B")]);
        runtime.update_proxy_chain_config(Some(vec![proxy("A"), proxy("B")]), None);

        runtime.update_proxy_chain_config(None, None);

        let proxies = runtime
            .config
            .as_ref()
            .unwrap()
            .get("proxies")
            .unwrap()
            .as_sequence()
            .unwrap();
        assert!(
            !proxies
                .iter()
                .any(|proxy| proxy.get("name").and_then(Value::as_str) == Some("A"))
        );
        let b = proxies
            .iter()
            .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some("B"))
            .unwrap();
        assert!(b.get("dialer-proxy").is_none());
        assert!(runtime.proxy_chain_injected.is_empty());
    }

    #[test]
    fn proxy_chain_temporarily_adds_exit_to_target_group() {
        let mut runtime = runtime_with_proxies(vec![proxy("A"), proxy("B")]);
        runtime.config.as_mut().unwrap().insert(
            Value::from("proxy-groups"),
            serde_yaml_ng::from_str("- name: Main\n  type: select\n  proxies: [DIRECT]\n").unwrap(),
        );

        runtime.update_proxy_chain_config(Some(vec![proxy("A"), proxy("B")]), Some("Main".into()));

        let groups = runtime
            .config
            .as_ref()
            .unwrap()
            .get("proxy-groups")
            .unwrap()
            .as_sequence()
            .unwrap();
        let members = groups[0].get("proxies").unwrap().as_sequence().unwrap();
        assert!(members.iter().any(|member| member.as_str() == Some("B")));

        runtime.update_proxy_chain_config(None, None);

        let groups = runtime
            .config
            .as_ref()
            .unwrap()
            .get("proxy-groups")
            .unwrap()
            .as_sequence()
            .unwrap();
        let members = groups[0].get("proxies").unwrap().as_sequence().unwrap();
        assert!(!members.iter().any(|member| member.as_str() == Some("B")));
        assert!(runtime.proxy_chain_group_injected.is_empty());
    }
}

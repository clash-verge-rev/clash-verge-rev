use crate::enhance::field::use_keys;
use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};
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

    //跟新链式代理配置文件
    /// {   
    ///     "proxies":[
    ///         {
    ///             name : entry_node_xxxx,
    ///             type: xxx
    ///             server: xxx
    ///             port: xxx
    ///             ports: xxx
    ///             password: xxx
    ///             skip-cert-verify: xxx,
    ///             dialer-proxy : "chain_1"
    ///        },
    ///         {
    ///             name : chain_node_1_xxxx,
    ///             type: xxx
    ///             server: xxx
    ///             port: xxx
    ///             ports: xxx
    ///             password: xxx
    ///             skip-cert-verify: xxx,
    ///             dialer-proxy : "chain_2"
    ///        },
    ///         {
    ///             name : chain_node_2_xxxx,
    ///             type: xxx
    ///             server: xxx
    ///             port: xxx
    ///             ports: xxx
    ///             password: xxx
    ///             skip-cert-verify: xxx,
    ///             dialer-proxy : "chain_3"
    ///        }
    ///     ],
    ///     "proxy-groups" : [
    ///         {
    ///             name : "chain_1",
    ///             type: "select",
    ///             proxies ["chain_node_1_xxxx"]
    ///         },
    ///         {
    ///             name : "chain_2",
    ///             type: "select",
    ///             proxies ["chain_node_2_xxxx"]
    ///         },
    ///         {
    ///             name : "chain_3",
    ///             type: "select",
    ///             proxies ["出口节点的name"]
    ///         }
    ///     ]
    /// }
    ///
    /// 传入none 为删除
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<serde_yaml_ng::Value>) {
        if let Some(config) = self.config.as_mut() {
            if let Some(serde_yaml_ng::Value::Sequence(proxies)) = config.get_mut("proxies") {
                proxies.retain(|proxy| proxy.get("dialer-proxy").is_none());
                proxies.retain(|proxy| proxy.get("name").is_some_and(|n| n.as_str().is_some_and(|n| !n.starts_with("chain_node_"))));
            }

            if let Some(serde_yaml_ng::Value::Sequence(proxy_groups)) =
                config.get_mut("proxy-groups")
            {
                proxy_groups.retain(|proxy_group| {

                    if matches!(proxy_group.get("name").and_then(|n| n.as_str()), Some(name) if name.starts_with("chain_") || name == "exit_node_group") {
                        false
                    } else {
                       true
                    }
                });
            }

            if let Some(serde_yaml_ng::Value::Sequence(rules)) =config.get_mut("rules"){
                rules.retain(|rule| rule.as_str() != Some("MATCH,chain_1"));
            }

            if let Some(proxy_chain_config) = proxy_chain_config {
                // println!("{:#?}",proxy_chain_config);
                // 读取 链式代理 和链式代理组
                if let (
                    Some(serde_yaml_ng::Value::Sequence(proxies_add)),
                    Some(serde_yaml_ng::Value::Sequence(proxy_groups_add)),
                    // Some(serde_yaml_ng::Value::Sequence(rules_add)),
                ) = (
                    proxy_chain_config.get("proxies"),
                    proxy_chain_config.get("proxy-groups"),
                    // proxy_chain_config.get("rule"),
                ) {
                    if let Some(serde_yaml_ng::Value::Sequence(proxies)) = config.get_mut("proxies")
                    {
                        proxies.extend(proxies_add.to_owned());
                    }

                    if let Some(serde_yaml_ng::Value::Sequence(proxy_groups)) =
                        config.get_mut("proxy-groups")
                    {
                        proxy_groups.extend(proxy_groups_add.to_owned());
                    }

                    if let Some(serde_yaml_ng::Value::Sequence(rules)) =
                        config.get_mut("rules")
                    {
                        if let Ok(rule)= serde_yaml_ng::to_value("MATCH,chain_1"){
                            rules.push(rule);
                        }                        
                    }
                }
            }
        }
    }
}

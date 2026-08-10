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
    /// 记录当前由链式代理 UI 设置过 dialer-proxy 的代理节点名称，
    /// 用于在断开链式代理时精确清理，避免误删扩展脚本 / merge 设置的 dialer-proxy
    pub chain_dialer_proxies: HashSet<String>,
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
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        // Step 1: 仅清理由链式代理 UI 上一次设置的 dialer-proxy，
        // 保留扩展脚本 / merge 等外部来源设置的 dialer-proxy
        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            for proxy in proxies.iter_mut() {
                if let Some(proxy_map) = proxy.as_mapping_mut()
                    && let Some(name) = proxy_map.get("name").and_then(|v| v.as_str()).map(|s| String::from(s))
                    && self.chain_dialer_proxies.contains(&name)
                {
                    proxy_map.remove("dialer-proxy");
                }
            }
        }

        // 重置追踪集合
        self.chain_dialer_proxies.clear();

        // Step 2: 根据新的链式代理配置设置 dialer-proxy
        if let Some(Value::Sequence(dialer_proxies)) = proxy_chain_config
            && let Some(Value::Sequence(proxies)) = config.get_mut("proxies")
        {
            for (i, dialer_proxy) in dialer_proxies.iter().enumerate() {
                if let Some(Value::Mapping(proxy)) =
                    proxies.iter_mut().find(|proxy| proxy.get("name") == Some(dialer_proxy))
                    && i != 0
                    && let Some(dialer_proxy) = dialer_proxies.get(i - 1)
                {
                    proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
                    // 记录此节点由链式代理 UI 管理
                    if let Some(name) = proxy.get("name").and_then(|v| v.as_str()) {
                        self.chain_dialer_proxies.insert(String::from(name));
                    }
                }
            }
        }
    }
}

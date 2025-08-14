use serde_yaml::{Mapping, Value};
use std::collections::HashSet;

pub const SORT_FIELDS: [&str; 17] = [
    "mode",
    "mixed-port",
    "port",
    "socks-port",
    "redir-port",
    "tproxy-port",
    "allow-lan",
    "ipv6",
    "log-level",
    "unified-delay",
    "find-process-mode",
    "external-controller",
    "external-controller-cors",
    "secret",
    "profile",
    "tun",
    "dns",
];

pub const DEFAULT_FIELDS: [&str; 5] = ["proxies", "proxy-providers", "proxy-groups", "rule-providers", "rules"];

pub fn use_filter(config: Mapping, filter: &[String]) -> Mapping {
    let mut res = Mapping::new();
    for (key, value) in config.into_iter() {
        if let Some(key) = key.as_str()
            && filter.contains(&key.to_string())
        {
            res.insert(key.into(), value);
        }
    }
    res
}

pub fn use_lowercase(config: Mapping) -> Mapping {
    let mut ret = Mapping::new();
    for (key, value) in config.into_iter() {
        if let Some(key_str) = key.as_str() {
            let mut key_str = String::from(key_str);
            key_str.make_ascii_lowercase();
            ret.insert(key_str.into(), value);
        }
    }
    ret
}

pub fn use_sort(config: Mapping) -> Mapping {
    let mut res = Mapping::new();
    SORT_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            res.insert(key, value.clone());
        }
    });

    let supported_keys = SORT_FIELDS.into_iter().chain(DEFAULT_FIELDS).collect::<HashSet<&str>>();

    let config_keys = config.keys().filter_map(|e| e.as_str()).collect::<HashSet<&str>>();

    config_keys.difference(&supported_keys).for_each(|&key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            res.insert(key, value.clone());
        }
    });
    DEFAULT_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            res.insert(key, value.clone());
        }
    });
    res
}

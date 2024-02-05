use serde_yaml::{Mapping, Value};
use std::collections::HashSet;

pub const HANDLE_FIELDS: [&str; 9] = [
    "mode",
    "mixed-port",
    "socks-port",
    "port",
    "allow-lan",
    "log-level",
    "ipv6",
    "secret",
    "external-controller",
];

pub const DEFAULT_FIELDS: [&str; 5] = [
    "proxies",
    "proxy-providers",
    "proxy-groups",
    "rule-providers",
    "rules",
];

pub fn use_filter(config: Mapping, filter: &Vec<String>) -> Mapping {
    let mut ret = Mapping::new();

    for (key, value) in config.into_iter() {
        if let Some(key) = key.as_str() {
            if filter.contains(&key.to_string()) {
                ret.insert(Value::from(key), value);
            }
        }
    }
    ret
}

pub fn use_lowercase(config: Mapping) -> Mapping {
    let mut ret = Mapping::new();

    for (key, value) in config.into_iter() {
        if let Some(key_str) = key.as_str() {
            let mut key_str = String::from(key_str);
            key_str.make_ascii_lowercase();
            ret.insert(Value::from(key_str), value);
        }
    }
    ret
}

pub fn use_sort(config: Mapping) -> Mapping {
    let mut ret = Mapping::new();
    HANDLE_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            ret.insert(key, value.clone());
        }
    });

    let supported_keys: HashSet<&str> = HANDLE_FIELDS.into_iter().chain(DEFAULT_FIELDS).collect();

    let config_keys: HashSet<&str> = config
        .keys()
        .filter_map(|e| e.as_str())
        .into_iter()
        .collect();

    config_keys.difference(&supported_keys).for_each(|&key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            ret.insert(key, value.clone());
        }
    });
    DEFAULT_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            ret.insert(key, value.clone());
        }
    });

    ret
}

pub fn use_keys(config: &Mapping) -> Vec<String> {
    config
        .iter()
        .filter_map(|(key, _)| key.as_str())
        .map(|s| {
            let mut s = s.to_string();
            s.make_ascii_lowercase();
            s
        })
        .collect()
}

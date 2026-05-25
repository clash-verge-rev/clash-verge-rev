use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;

pub const HANDLE_FIELDS: [&str; 12] = [
    "mode",
    "redir-port",
    "tproxy-port",
    "mixed-port",
    "socks-port",
    "port",
    "allow-lan",
    "log-level",
    "ipv6",
    "external-controller",
    "secret",
    "unified-delay",
];

pub const DEFAULT_FIELDS: [&str; 5] = ["proxies", "proxy-providers", "proxy-groups", "rule-providers", "rules"];

fn lowercase_key(key: &str) -> Value {
    let mut key = String::from(key);
    key.make_ascii_lowercase();
    Value::from(key.as_str())
}

pub fn use_lowercase(config: &Mapping) -> Mapping {
    let mut ret = Mapping::new();

    for (key, value) in config.into_iter() {
        if let Some(key_str) = key.as_str() {
            ret.insert(lowercase_key(key_str), value.clone());
        }
    }
    ret
}

pub fn use_lowercase_owned(config: Mapping) -> Mapping {
    let mut ret = Mapping::new();

    for (key, value) in config {
        if let Some(key_str) = key.as_str() {
            ret.insert(lowercase_key(key_str), value);
        }
    }
    ret
}

pub fn use_sort(mut config: Mapping) -> Mapping {
    let mut ret = Mapping::new();
    HANDLE_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = config.remove(&key) {
            ret.insert(key, value);
        }
    });

    let mut default_fields = Mapping::new();
    for (key, value) in config {
        if let Some(key_str) = key.as_str() {
            if DEFAULT_FIELDS.contains(&key_str) {
                default_fields.insert(key, value);
            } else if !HANDLE_FIELDS.contains(&key_str) {
                ret.insert(key, value);
            }
        }
    }

    DEFAULT_FIELDS.into_iter().for_each(|key| {
        let key = Value::from(key);
        if let Some(value) = default_fields.remove(&key) {
            ret.insert(key, value);
        }
    });

    ret
}

#[inline]
pub fn use_keys<'a>(config: &'a Mapping) -> impl Iterator<Item = String> + 'a {
    config.iter().filter_map(|(key, _)| key.as_str()).map(|s: &str| {
        let mut s: String = s.into();
        s.make_ascii_lowercase();
        s
    })
}

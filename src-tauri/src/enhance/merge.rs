use super::field::use_lowercase;
use serde_yaml_ng::{self, Mapping, Value};

fn deep_merge(a: &mut Value, b: Value) {
    match (a, b) {
        (Value::Mapping(a_map), Value::Mapping(b_map)) => {
            for (key, value) in b_map {
                if let Some(existing) = a_map.get_mut(&key) {
                    deep_merge(existing, value);
                } else {
                    a_map.insert(key, value);
                }
            }
        }
        (a, b) => *a = b,
    }
}

pub fn use_merge(merge: &Mapping, mut config: Mapping) -> Mapping {
    for (key, value) in use_lowercase(merge) {
        match (config.get_mut(&key), value) {
            (Some(Value::Mapping(existing)), Value::Mapping(overlay)) if key.as_str() == Some("dns") => {
                existing.extend(overlay);
            }
            (Some(existing), value) if key.as_str() != Some("hosts") => deep_merge(existing, value),
            (_, value) => {
                config.insert(key, value);
            }
        }
    }
    config
}

#[test]
fn test_merge() -> anyhow::Result<()> {
    let merge = r"
    prepend-rules:
      - prepend
      - 1123123
    append-rules:
      - append
    prepend-proxies:
      - 9999
    append-proxies:
      - 1111
    rules:
      - replace
    proxy-groups: 
      - 123781923810
    tun:
      enable: true
    dns:
      enable: true
      nameserver-policy:
        new.example: 1.1.1.1
      fallback-filter:
        geoip: false
    hosts:
      new.example: 192.0.2.2
  ";

    let config = r"
    rules:
      - aaaaa
    script1: test
    tun:
      mtu: 1500
    dns:
      nameserver: [9.9.9.9]
      nameserver-policy:
        old.example: 8.8.8.8
      fallback-filter:
        geoip: true
        domain: [old.example]
    hosts:
      old.example: 192.0.2.1
  ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    assert_eq!(result["dns"]["nameserver-policy"], merge["dns"]["nameserver-policy"]);
    assert_eq!(result["dns"]["fallback-filter"], merge["dns"]["fallback-filter"]);
    assert_eq!(result["hosts"], merge["hosts"]);
    assert_eq!(result["dns"]["nameserver"], serde_yaml_ng::to_value(["9.9.9.9"])?);
    assert_eq!(result["tun"]["mtu"], Value::from(1500));
    assert_eq!(result["rules"], merge["rules"]);
    assert_eq!(result["script1"], Value::from("test"));

    let cleared = serde_yaml_ng::from_str::<Mapping>(
        "dns: {enable: false, nameserver-policy: {}, fallback-filter: {}, nameserver: []}\nhosts: {}",
    )?;
    let result = use_merge(&cleared, result);
    assert_eq!(result["dns"], cleared["dns"]);
    assert_eq!(result["hosts"], cleared["hosts"]);

    Ok(())
}

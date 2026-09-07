use clash_verge_logging::{Type, logging};

use super::use_lowercase;
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

/// Special keys supported by the v1.x Merge config. Since v1.7.x their
/// behavior moved to the per-subscription visual editors (e.g. the
/// "Edit Rules" editor), so they no longer carry any meaning here.
/// Deep-merging them verbatim leaks them into the generated runtime
/// config, where the core silently ignores them — so strip them with
/// a deprecation warning instead of failing silently.
const LEGACY_MERGE_KEYS: &[&str] = &[
    "prepend-rules",
    "append-rules",
    "prepend-proxies",
    "append-proxies",
    "prepend-proxy-groups",
    "append-proxy-groups",
];

pub fn use_merge(merge: &Mapping, config: Mapping) -> Mapping {
    let mut config = Value::from(config);
    let mut merge = use_lowercase(merge);

    for key in LEGACY_MERGE_KEYS {
        if let Some(value) = merge.remove(*key) {
            logging!(
                warn,
                Type::Core,
                "merge config: the legacy key `{}` is no longer supported since v1.7.x and was ignored ({} item(s) found); prepend/append rules now live in the per-subscription 'Edit Rules' editor, or can be applied with an extension script",
                key,
                value.as_sequence().map(|seq| seq.len()).unwrap_or(0)
            );
        }
    }

    deep_merge(&mut config, Value::from(merge));

    config.as_mapping().cloned().unwrap_or_else(|| {
        logging!(
            error,
            Type::Core,
            "Failed to convert merged config to mapping, using empty mapping"
        );
        Mapping::new()
    })
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
  ";

    let config = r"
    rules:
      - aaaaa
    script1: test
  ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let merged = use_merge(&merge, config);

    // legacy v1.x keys must not leak into the runtime config
    for key in LEGACY_MERGE_KEYS {
        assert!(
            merged.get(key).is_none(),
            "legacy key `{key}` should be stripped from the merged config"
        );
    }
    // plain merge semantics unchanged: rules is replaced by the merge
    let rules = merged.get("rules").and_then(|v| v.as_sequence()).unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].as_str().unwrap(), "replace");
    assert_eq!(
        merged
            .get("tun")
            .and_then(|v| v.get("enable"))
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    let _ = serde_yaml_ng::to_string(&merged)?;

    Ok(())
}

#[test]
fn test_merge_keeps_plain_keys() -> anyhow::Result<()> {
    let merge = r"
    rules:
      - DOMAIN-SUFFIX,example.com,DIRECT
    tun:
      enable: true
  ";

    let config = r"
    port: 7897
    rules:
      - MATCH,DIRECT
  ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let merged = use_merge(&merge, config);

    assert_eq!(merged.get("port").and_then(|v| v.as_u64()), Some(7897));
    let rules = merged.get("rules").and_then(|v| v.as_sequence()).unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].as_str().unwrap(), "DOMAIN-SUFFIX,example.com,DIRECT");
    assert_eq!(
        merged
            .get("tun")
            .and_then(|v| v.get("enable"))
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    Ok(())
}

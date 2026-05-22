use clash_verge_logging::{Type, logging};

use super::use_lowercase;
use serde_yaml_ng::{self, Mapping, Value};

const MERGE_SEQ_FIELDS: [&str; 3] = ["rules", "proxies", "proxy-groups"];
const MERGE_SEQ_OPERATIONS: [&str; 2] = ["prepend", "append"];

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
        // Non-mapping types (scalars, sequences) are replaced entirely by the merge value.
        (a, b) => *a = b,
    }
}

fn is_seq_operation_key(key: &Value) -> bool {
    key.as_str()
        .and_then(|key| key.split_once('-'))
        .is_some_and(|(op, field)| MERGE_SEQ_OPERATIONS.contains(&op) && MERGE_SEQ_FIELDS.contains(&field))
}

pub fn use_merge(merge: &Mapping, config: Mapping) -> Mapping {
    let mut config = Value::from(config);
    let merge = use_lowercase(merge);

    let merge_without_seq: Mapping = merge
        .iter()
        .filter(|(k, _)| !is_seq_operation_key(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    deep_merge(&mut config, Value::from(merge_without_seq));

    let mut config = config.as_mapping().cloned().unwrap_or_else(|| {
        logging!(
            error,
            Type::Core,
            "Failed to convert merged config to mapping, using empty mapping"
        );
        Mapping::new()
    });

    for field in MERGE_SEQ_FIELDS {
        let field_key = Value::from(field);
        let mut seq = config
            .get(&field_key)
            .and_then(Value::as_sequence)
            .cloned()
            .unwrap_or_default();

        let prepend_key = Value::from(format!("prepend-{field}"));
        if let Some(prepend) = merge.get(&prepend_key).and_then(Value::as_sequence) {
            let mut next_seq = prepend.clone();
            next_seq.extend(seq);
            seq = next_seq;
        }

        let append_key = Value::from(format!("append-{field}"));
        if let Some(append) = merge.get(&append_key).and_then(Value::as_sequence) {
            seq.extend(append.clone());
        }

        if !seq.is_empty() {
            config.insert(field_key, Value::Sequence(seq));
        }
    }

    config
}

#[test]
fn test_merge() -> anyhow::Result<()> {
    let merge = r"
    prepend-rules:
      - prepend
      - '1123123'
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

    let result = use_merge(&merge, config);
    let rules = result
        .get("rules")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let rules: Vec<_> = rules.iter().filter_map(Value::as_str).collect();

    assert_eq!(rules, vec!["prepend", "1123123", "replace", "append"]);
    assert!(result.get("prepend-rules").is_none());
    assert!(result.get("append-rules").is_none());

    // proxies: no original proxies in config, prepend(9999) + append(1111)
    let proxies = result
        .get("proxies")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let proxies: Vec<_> = proxies.iter().filter_map(Value::as_i64).collect();
    assert_eq!(proxies, vec![9999, 1111]);
    assert!(result.get("prepend-proxies").is_none());
    assert!(result.get("append-proxies").is_none());

    // proxy-groups: deep_merge replaced with [123781923810], no prepend/append
    let groups = result
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let groups: Vec<_> = groups.iter().filter_map(Value::as_i64).collect();
    assert_eq!(groups, vec![123781923810_i64]);

    // tun and dns should be deep merged
    assert_eq!(
        result.get("tun").and_then(|v| v.get("enable")).and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        result.get("dns").and_then(|v| v.get("enable")).and_then(Value::as_bool),
        Some(true)
    );

    Ok(())
}

#[test]
fn test_merge_prepends_and_appends_proxy_groups() -> anyhow::Result<()> {
    let merge = r"
    prepend-proxy-groups:
      - name: Before
        type: select
        proxies:
          - DIRECT
    append-proxy-groups:
      - name: After
        type: select
        proxies:
          - REJECT
  ";

    let config = r"
    proxy-groups:
      - name: Original
        type: select
        proxies:
          - DIRECT
  ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    let groups = result
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let names: Vec<_> = groups
        .iter()
        .filter_map(Value::as_mapping)
        .filter_map(|group| group.get("name"))
        .filter_map(Value::as_str)
        .collect();

    assert_eq!(names, vec!["Before", "Original", "After"]);
    assert!(result.get("prepend-proxy-groups").is_none());
    assert!(result.get("append-proxy-groups").is_none());

    Ok(())
}

#[test]
fn test_merge_with_empty_merge() -> anyhow::Result<()> {
    let merge = "";
    let config = r"
    rules:
      - original-rule
    ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    let seq = result
        .get("rules")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let rules: Vec<_> = seq.iter().filter_map(Value::as_str).collect();

    assert_eq!(rules, vec!["original-rule"]);
    Ok(())
}

#[test]
fn test_merge_non_sequence_value_ignored() -> anyhow::Result<()> {
    let merge = r"
    prepend-rules: not-a-sequence
    ";
    let config = r"
    rules:
      - original-rule
    ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    let seq = result
        .get("rules")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let rules: Vec<_> = seq.iter().filter_map(Value::as_str).collect();

    // prepend-rules was a string, not a sequence, so it is silently ignored.
    assert_eq!(rules, vec!["original-rule"]);
    assert!(result.get("prepend-rules").is_none());
    Ok(())
}

#[test]
fn test_merge_case_insensitive_keys() -> anyhow::Result<()> {
    let merge = r"
    Prepend-Rules:
      - PREPENDED
    ";
    let config = r"
    rules:
      - original
    ";

    let merge = serde_yaml_ng::from_str::<Mapping>(merge)?;
    let config = serde_yaml_ng::from_str::<Mapping>(config)?;

    let result = use_merge(&merge, config);
    let seq = result
        .get("rules")
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();
    let rules: Vec<_> = seq.iter().filter_map(Value::as_str).collect();

    // use_lowercase converts Prepend-Rules to prepend-rules before processing
    assert_eq!(rules, vec!["PREPENDED", "original"]);
    assert!(result.get("prepend-rules").is_none());
    assert!(result.get("Prepend-Rules").is_none());
    Ok(())
}

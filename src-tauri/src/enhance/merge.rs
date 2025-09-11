use super::use_lowercase;
use serde_yaml_ng::{self, Mapping, Value};

fn deep_merge(a: &mut Value, b: &Value) {
    match (a, b) {
        (&mut Value::Mapping(ref mut a), Value::Mapping(b)) => {
            for (k, v) in b {
                deep_merge(a.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (a, b) => *a = b.clone(),
    }
}

pub fn use_merge(merge: Mapping, config: Mapping) -> Mapping {
    let mut config = Value::from(config);
    let merge = use_lowercase(merge.clone());

    deep_merge(&mut config, &Value::from(merge));

    config.as_mapping().cloned().unwrap_or_else(|| {
        log::error!("Failed to convert merged config to mapping, using empty mapping");
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

    let _ = serde_yaml_ng::to_string(&use_merge(merge, config))?;

    Ok(())
}

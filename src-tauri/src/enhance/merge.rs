use super::{use_filter, use_lowercase};
use serde_yaml::{self, Mapping, Sequence, Value};

const MERGE_FIELDS: [&str; 6] = [
    "prepend-rules",
    "append-rules",
    "prepend-proxies",
    "append-proxies",
    "prepend-proxy-groups",
    "append-proxy-groups",
];

fn deep_merge(a: &mut Value, b: &Value) {
    match (a, b) {
        (&mut Value::Mapping(ref mut a), &Value::Mapping(ref b)) => {
            for (k, v) in b {
                deep_merge(a.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (a, b) => *a = b.clone(),
    }
}

pub fn use_merge(merge: Mapping, config: Mapping) -> Mapping {
    let mut config = Value::from(config);
    let mut merge_without_append = use_lowercase(merge.clone());
    for key in MERGE_FIELDS {
        merge_without_append.remove(key).unwrap_or_default();
    }
    deep_merge(&mut config, &Value::from(merge_without_append));

    let mut config = config.as_mapping().unwrap().clone();
    let merge_list = MERGE_FIELDS.iter().map(|s| s.to_string());
    let merge = use_filter(merge, &merge_list.collect());

    ["rules", "proxies", "proxy-groups"]
        .iter()
        .for_each(|key_str| {
            let key_val = Value::from(key_str.to_string());

            let mut list = Sequence::default();
            list = config.get(&key_val).map_or(list.clone(), |val| {
                val.as_sequence().map_or(list, |v| v.clone())
            });

            let pre_key = Value::from(format!("prepend-{key_str}"));
            let post_key = Value::from(format!("append-{key_str}"));

            if let Some(pre_val) = merge.get(&pre_key) {
                if pre_val.is_sequence() {
                    let mut pre_val = pre_val.as_sequence().unwrap().clone();
                    pre_val.extend(list);
                    list = pre_val;
                }
            }

            if let Some(post_val) = merge.get(&post_key) {
                if post_val.is_sequence() {
                    list.extend(post_val.as_sequence().unwrap().clone());
                }
            }

            if !list.is_empty() {
                config.insert(key_val, Value::from(list));
            }
        });
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
  ";

    let config = r"
    rules:
      - aaaaa
    script1: test
  ";

    let merge = serde_yaml::from_str::<Mapping>(merge)?;
    let config = serde_yaml::from_str::<Mapping>(config)?;

    let result = serde_yaml::to_string(&use_merge(merge, config))?;

    println!("{result}");

    Ok(())
}

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

pub fn use_merge(merge: Mapping, mut config: Mapping) -> Mapping {
    // 直接覆盖原字段
    use_lowercase(merge.clone())
        .into_iter()
        .for_each(|(key, value)| {
            config.insert(key, value);
        });

    let merge_list = MERGE_FIELDS.iter().map(|s| s.to_string());
    let merge = use_filter(merge, &merge_list.collect(), true);

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

            config.insert(key_val, Value::from(list));
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

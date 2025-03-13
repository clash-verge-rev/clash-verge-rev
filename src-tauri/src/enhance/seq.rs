use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Sequence, Value};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeqMap {
    pub prepend: Sequence,
    pub append: Sequence,
    pub delete: Vec<String>,
}

pub fn use_seq(seq: SeqMap, mut config: Mapping, field: &str) -> Mapping {
    let SeqMap {
        prepend,
        append,
        delete,
    } = seq;

    let mut new_seq = Sequence::new();
    new_seq.extend(prepend);

    if let Some(Value::Sequence(origin)) = config.get(field) {
        // Filter out deleted items
        let filtered: Sequence = origin
            .iter()
            .filter(|item| {
                if let Value::String(s) = item {
                    !delete.contains(s)
                } else if let Value::Mapping(m) = item {
                    if let Some(Value::String(name)) = m.get("name") {
                        !delete.contains(name)
                    } else {
                        true
                    }
                } else {
                    true
                }
            })
            .cloned()
            .collect();
        new_seq.extend(filtered);
    }

    new_seq.extend(append);
    config.insert(Value::String(field.into()), Value::Sequence(new_seq));

    // If this is proxies field, we also need to filter proxy-groups
    if field == "proxies" {
        if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
            let mut new_groups = Sequence::new();
            for group in groups {
                if let Value::Mapping(group_map) = group {
                    let mut new_group = group_map.clone();
                    if let Some(Value::Sequence(proxies)) = group_map.get("proxies") {
                        let filtered_proxies: Sequence = proxies
                            .iter()
                            .filter(|p| {
                                if let Value::String(name) = p {
                                    !delete.contains(name)
                                } else {
                                    true
                                }
                            })
                            .cloned()
                            .collect();
                        new_group.insert(
                            Value::String("proxies".into()),
                            Value::Sequence(filtered_proxies),
                        );
                    }
                    new_groups.push(Value::Mapping(new_group));
                } else {
                    new_groups.push(group.clone());
                }
            }
            config.insert(
                Value::String("proxy-groups".into()),
                Value::Sequence(new_groups),
            );
        }
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use serde_yaml::Value;

    #[test]
    fn test_delete_proxy_and_references() {
        let config_str = r#"
proxies:
- name: "proxy1"
  type: "ss"
- name: "proxy2"
  type: "vmess"
proxy-groups:
- name: "group1"
  type: "select"
  proxies:
    - "proxy1"
    - "proxy2"
- name: "group2"
  type: "select"
  proxies:
    - "proxy1"
"#;
        let mut config: Mapping = serde_yaml::from_str(config_str).unwrap();

        let seq = SeqMap {
            prepend: Sequence::new(),
            append: Sequence::new(),
            delete: vec!["proxy1".to_string()],
        };

        config = use_seq(seq, config, "proxies");

        // Check if proxy1 is removed from proxies
        let proxies = config.get("proxies").unwrap().as_sequence().unwrap();
        assert_eq!(proxies.len(), 1);
        assert_eq!(
            proxies[0]
                .as_mapping()
                .unwrap()
                .get("name")
                .unwrap()
                .as_str()
                .unwrap(),
            "proxy2"
        );

        // Check if proxy1 is removed from all groups
        let groups = config.get("proxy-groups").unwrap().as_sequence().unwrap();
        let group1_proxies = groups[0]
            .as_mapping()
            .unwrap()
            .get("proxies")
            .unwrap()
            .as_sequence()
            .unwrap();
        let group2_proxies = groups[1]
            .as_mapping()
            .unwrap()
            .get("proxies")
            .unwrap()
            .as_sequence()
            .unwrap();

        assert_eq!(group1_proxies.len(), 1);
        assert_eq!(group1_proxies[0].as_str().unwrap(), "proxy2");
        assert_eq!(group2_proxies.len(), 0);
    }
}

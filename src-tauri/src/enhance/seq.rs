use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Sequence, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeqMap {
    pub prepend: Sequence,
    pub append: Sequence,
    pub delete: Vec<String>,
}

fn collect_proxy_names(seq: &Sequence) -> Vec<String> {
    seq.iter()
        .filter_map(|item| match item {
            Value::Mapping(map) => map.get("name").and_then(Value::as_str).map(str::to_owned),
            Value::String(name) => Some(name.to_owned()),
            _ => None,
        })
        .collect()
}

fn is_selector_group(group_map: &Mapping) -> bool {
    group_map
        .get("type")
        .and_then(Value::as_str)
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value == "select" || value == "selector"
        })
        .unwrap_or(false)
}

pub fn use_seq(seq: SeqMap, mut config: Mapping, field: &str) -> Mapping {
    let SeqMap {
        prepend,
        append,
        delete,
    } = seq;

    let added_proxy_names = if field == "proxies" {
        let mut names = collect_proxy_names(&prepend);
        names.extend(collect_proxy_names(&append));
        let mut seen = HashSet::new();
        names
            .into_iter()
            .filter(|name| seen.insert(name.clone()))
            .collect::<Vec<String>>()
    } else {
        Vec::new()
    };

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
    if field == "proxies"
        && let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups")
    {
        let mut new_groups = Sequence::new();
        let mut appended_to_selector = false;
        for group in groups {
            if let Value::Mapping(group_map) = group {
                let mut proxies_seq = group_map.get("proxies").and_then(Value::as_sequence).map(|proxies| {
                    proxies
                        .iter()
                        .filter(|p| {
                            if let Value::String(name) = p {
                                !delete.contains(name)
                            } else {
                                true
                            }
                        })
                        .cloned()
                        .collect::<Sequence>()
                });

                if !appended_to_selector && !added_proxy_names.is_empty() && is_selector_group(group_map) {
                    let base_seq = proxies_seq.unwrap_or_else(Sequence::new);
                    let mut seq = Sequence::new();
                    let mut existing = HashSet::new();
                    for name in &added_proxy_names {
                        if existing.insert(name.clone()) {
                            seq.push(Value::String(name.clone()));
                        }
                    }
                    for value in base_seq {
                        if let Value::String(name) = &value
                            && !existing.insert(name.to_owned())
                        {
                            continue;
                        }

                        seq.push(value);
                    }
                    proxies_seq = Some(seq);
                    appended_to_selector = true;
                }

                if let Some(seq) = proxies_seq {
                    group_map.insert(Value::String("proxies".into()), Value::Sequence(seq));
                }
                new_groups.push(Value::Mapping(group_map.to_owned()));
            } else {
                new_groups.push(group.to_owned());
            }
        }
        config.insert(Value::String("proxy-groups".into()), Value::Sequence(new_groups));
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use serde_yaml_ng::Value;

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
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
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let seq = SeqMap {
            prepend: Sequence::new(),
            append: Sequence::new(),
            delete: vec!["proxy1".to_string()],
        };

        config = use_seq(seq, config, "proxies");

        // Check if proxy1 is removed from proxies
        let proxies = config
            .get("proxies")
            .expect("proxies field should exist")
            .as_sequence()
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 1);
        assert_eq!(
            proxies[0]
                .as_mapping()
                .expect("proxy should be a mapping")
                .get("name")
                .expect("proxy should have name")
                .as_str()
                .expect("name should be string"),
            "proxy2"
        );

        // Check if proxy1 is removed from all groups
        let groups = config
            .get("proxy-groups")
            .expect("proxy-groups field should exist")
            .as_sequence()
            .expect("proxy-groups should be a sequence");
        let group1_proxies = groups[0]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let group2_proxies = groups[1]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");

        assert_eq!(group1_proxies.len(), 1);
        assert_eq!(
            group1_proxies[0].as_str().expect("proxy name should be string"),
            "proxy2"
        );
        assert_eq!(group2_proxies.len(), 0);
    }

    #[test]
    #[allow(clippy::unwrap_used)]
    #[allow(clippy::expect_used)]
    fn test_add_new_proxies_to_first_selector_group() {
        let config_str = r#"
proxies:
- name: "proxy1"
  type: "ss"
proxy-groups:
- name: "group1"
  type: "select"
  proxies:
    - "proxy1"
- name: "group2"
  type: "select"
  proxies:
    - "proxy1"
"#;
        let mut config: Mapping = serde_yaml_ng::from_str(config_str).expect("Failed to parse test config YAML");

        let prepend: Sequence = serde_yaml_ng::from_str(
            r#"
- name: "proxy3"
  type: "ss"
"#,
        )
        .expect("Failed to parse prepend proxies");

        let append: Sequence = serde_yaml_ng::from_str(
            r#"
- name: "proxy4"
  type: "vmess"
"#,
        )
        .expect("Failed to parse append proxies");

        let seq = SeqMap {
            prepend,
            append,
            delete: vec![],
        };

        config = use_seq(seq, config, "proxies");

        let groups = config
            .get("proxy-groups")
            .expect("proxy-groups field should exist")
            .as_sequence()
            .expect("proxy-groups should be a sequence");
        let group1_proxies = groups[0]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let names: Vec<&str> = group1_proxies.iter().filter_map(Value::as_str).collect();
        assert_eq!(names, vec!["proxy3", "proxy4", "proxy1"]);

        let group2_proxies = groups[1]
            .as_mapping()
            .expect("group should be a mapping")
            .get("proxies")
            .expect("group should have proxies")
            .as_sequence()
            .expect("group proxies should be a sequence");
        let names: Vec<&str> = group2_proxies.iter().filter_map(Value::as_str).collect();
        assert_eq!(names, vec!["proxy1"]);
    }
}

use super::SmartSettings;
use serde_yaml_ng::{Mapping, Value};

pub(super) const SMART_CORE: &str = "verge-mihomo-smart";

const SMART_TOP_LEVEL_KEYS: &[&str] = &["lgbm-auto-update", "lgbm-update-interval", "lgbm-url"];
const SMART_PROFILE_KEYS: &[&str] = &["smart-collector-size"];
const SMART_GROUP_KEYS: &[&str] = &[
    "policy-priority",
    "prefer-asn",
    "uselightgbm",
    "collectdata",
    "sample-rate",
    "maxuploadrate",
    "maxdownloadrate",
];
const SMART_GROUP_DOWNGRADE_TYPE: &str = "url-test";
// 与 src/services/delay.ts 的默认测速地址保持一致，仅在 default_latency_test 未配置时兜底
const FALLBACK_LATENCY_TEST_URL: &str = "http://cp.cloudflare.com/generate_204";
const FALLBACK_LATENCY_TEST_INTERVAL: u64 = 300;
const SMART_AUTO_SWITCH_REMOVED_KEYS: &[&str] =
    &["strategy", "url", "interval", "tolerance", "lazy", "expected-status"];

pub(super) fn apply_core_runtime_settings(config: Mapping, core: Option<&str>, settings: &SmartSettings) -> Mapping {
    if is_smart_core(core) {
        apply_smart_runtime_settings(config, settings)
    } else {
        strip_smart_runtime_settings(config, settings)
    }
}

fn is_smart_core(core: Option<&str>) -> bool {
    matches!(core, Some(SMART_CORE))
}

fn apply_smart_runtime_settings(config: Mapping, settings: &SmartSettings) -> Mapping {
    let config = apply_smart_strategy_auto_switch(config, settings);
    apply_smart_core_settings(config, settings)
}

fn apply_smart_strategy_auto_switch(mut config: Mapping, settings: &SmartSettings) -> Mapping {
    if !settings.strategy_auto_switch {
        return config;
    }

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups {
            let Some(group_map) = group.as_mapping_mut() else {
                continue;
            };

            let group_type = group_map.get("type").and_then(Value::as_str);
            if !matches!(group_type, Some("url-test" | "load-balance")) {
                continue;
            }

            group_map.insert(Value::String("type".into()), Value::String("smart".into()));
            for key in SMART_AUTO_SWITCH_REMOVED_KEYS {
                group_map.remove(*key);
            }

            if let Some(policy_priority) = settings.policy_priority.as_ref() {
                insert_if_missing(
                    group_map,
                    "policy-priority",
                    Value::String(policy_priority.as_str().into()),
                );
            }
            insert_if_missing(group_map, "prefer-asn", Value::Bool(settings.prefer_asn));
            insert_if_missing(group_map, "uselightgbm", Value::Bool(settings.use_lightgbm));
            insert_if_missing(group_map, "collectdata", Value::Bool(settings.collect_data));
            if let Ok(value) = serde_yaml_ng::to_value(settings.sample_rate) {
                insert_if_missing(group_map, "sample-rate", value);
            }
        }
    }

    config
}

fn insert_if_missing(group: &mut Mapping, key: &str, value: Value) {
    if !group.contains_key(key) {
        group.insert(Value::String(key.into()), value);
    }
}

fn apply_smart_core_settings(mut config: Mapping, settings: &SmartSettings) -> Mapping {
    config.insert(
        Value::String("lgbm-auto-update".into()),
        Value::Bool(settings.lgbm_auto_update),
    );
    if let Ok(value) = serde_yaml_ng::to_value(settings.lgbm_update_interval) {
        config.insert(Value::String("lgbm-update-interval".into()), value);
    }
    config.insert(
        Value::String("lgbm-url".into()),
        Value::String(settings.lgbm_url.to_string()),
    );

    let profile_key = Value::String("profile".into());
    if let Ok(collector_size) = serde_yaml_ng::to_value(settings.collector_size) {
        match config.get_mut(&profile_key) {
            Some(Value::Mapping(profile)) => {
                profile.insert(Value::String(SMART_PROFILE_KEYS[0].into()), collector_size);
            }
            _ => {
                let mut profile = Mapping::new();
                profile.insert(Value::String(SMART_PROFILE_KEYS[0].into()), collector_size);
                config.insert(profile_key, Value::Mapping(profile));
            }
        }
    }

    config
}

fn strip_smart_runtime_settings(mut config: Mapping, settings: &SmartSettings) -> Mapping {
    for key in SMART_TOP_LEVEL_KEYS {
        config.remove(*key);
    }

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups {
            let Some(group_map) = group.as_mapping_mut() else {
                continue;
            };

            // 标准内核不认识 smart 组类型，残留会导致配置校验失败，
            // 默认降级为语义最接近的 url-test（auto-switch 正向转换的镜像）
            if settings.group_downgrade && group_map.get("type").and_then(Value::as_str) == Some("smart") {
                group_map.insert(
                    Value::String("type".into()),
                    Value::String(SMART_GROUP_DOWNGRADE_TYPE.into()),
                );
                let url = settings
                    .latency_test_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(FALLBACK_LATENCY_TEST_URL);
                insert_if_missing(group_map, "url", Value::String(url.into()));
                insert_if_missing(
                    group_map,
                    "interval",
                    Value::Number(FALLBACK_LATENCY_TEST_INTERVAL.into()),
                );
            }

            for key in SMART_GROUP_KEYS {
                group_map.remove(*key);
            }
        }
    }

    let profile_key = Value::String("profile".into());
    let remove_profile = if let Some(Value::Mapping(profile)) = config.get_mut(&profile_key) {
        for key in SMART_PROFILE_KEYS {
            profile.remove(*key);
        }
        profile.is_empty()
    } else {
        false
    };

    if remove_profile {
        config.remove(&profile_key);
    }

    config
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_group(group_yaml: &str) -> Result<Mapping, serde_yaml_ng::Error> {
        serde_yaml_ng::from_str(&format!("proxy-groups:\n{group_yaml}"))
    }

    fn group_field<'a>(config: &'a Mapping, index: usize, key: &str) -> Option<&'a Value> {
        config
            .get("proxy-groups")
            .and_then(Value::as_sequence)
            .and_then(|groups| groups.get(index))
            .and_then(Value::as_mapping)
            .and_then(|group| group.get(key))
    }

    #[test]
    fn strip_downgrades_smart_group_to_url_test() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group(
            "  - name: Auto\n    type: smart\n    proxies: [a, b]\n    uselightgbm: true\n    maxuploadrate: 10\n    maxdownloadrate: 20\n",
        )?;
        let settings = SmartSettings {
            group_downgrade: true,
            ..SmartSettings::default()
        };

        let result = strip_smart_runtime_settings(config, &settings);

        assert_eq!(
            group_field(&result, 0, "type").and_then(Value::as_str),
            Some("url-test")
        );
        assert_eq!(
            group_field(&result, 0, "url").and_then(Value::as_str),
            Some(FALLBACK_LATENCY_TEST_URL)
        );
        assert_eq!(
            group_field(&result, 0, "interval").and_then(Value::as_u64),
            Some(FALLBACK_LATENCY_TEST_INTERVAL)
        );
        for key in SMART_GROUP_KEYS {
            assert_eq!(group_field(&result, 0, key), None, "{key} should be stripped");
        }
        Ok(())
    }

    #[test]
    fn strip_downgrade_uses_configured_latency_test_url() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group("  - name: Auto\n    type: smart\n    proxies: [a]\n")?;
        let settings = SmartSettings {
            group_downgrade: true,
            latency_test_url: Some("http://www.gstatic.com/generate_204".into()),
            ..SmartSettings::default()
        };

        let result = strip_smart_runtime_settings(config, &settings);

        assert_eq!(
            group_field(&result, 0, "url").and_then(Value::as_str),
            Some("http://www.gstatic.com/generate_204")
        );
        Ok(())
    }

    #[test]
    fn strip_downgrade_keeps_existing_url_and_interval() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group(
            "  - name: Auto\n    type: smart\n    proxies: [a]\n    url: http://example.com/204\n    interval: 60\n",
        )?;
        let settings = SmartSettings {
            group_downgrade: true,
            ..SmartSettings::default()
        };

        let result = strip_smart_runtime_settings(config, &settings);

        assert_eq!(
            group_field(&result, 0, "type").and_then(Value::as_str),
            Some("url-test")
        );
        assert_eq!(
            group_field(&result, 0, "url").and_then(Value::as_str),
            Some("http://example.com/204")
        );
        assert_eq!(group_field(&result, 0, "interval").and_then(Value::as_u64), Some(60));
        Ok(())
    }

    #[test]
    fn strip_without_downgrade_keeps_type_but_strips_keys() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group("  - name: Auto\n    type: smart\n    proxies: [a]\n    collectdata: true\n")?;
        let settings = SmartSettings::default();

        let result = strip_smart_runtime_settings(config, &settings);

        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("smart"));
        assert_eq!(group_field(&result, 0, "collectdata"), None);
        assert_eq!(group_field(&result, 0, "url"), None);
        Ok(())
    }

    #[test]
    fn strip_leaves_ordinary_groups_untouched() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group(
            "  - name: Manual\n    type: select\n    proxies: [a]\n  - name: Fast\n    type: url-test\n    proxies: [a]\n    url: http://example.com/204\n    interval: 120\n",
        )?;
        let settings = SmartSettings {
            group_downgrade: true,
            ..SmartSettings::default()
        };

        let result = strip_smart_runtime_settings(config, &settings);

        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("select"));
        assert_eq!(group_field(&result, 1, "interval").and_then(Value::as_u64), Some(120));
        Ok(())
    }
}

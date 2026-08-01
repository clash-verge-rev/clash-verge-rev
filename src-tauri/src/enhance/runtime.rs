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
const SMART_FALLBACK_GROUP_NAME: &str = "Smart Group";
// strategy/tolerance 分别是 load-balance / url-test 专属语义，转换为 smart 后无意义；
// url/interval/lazy/expected-status 仍被 smart 组用于健康检查（内核以 url 作为 testUrl
// 参与存活判定与权重排名），保留订阅原值
const SMART_AUTO_SWITCH_REMOVED_KEYS: &[&str] = &["strategy", "tolerance"];

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

    let fallback_group = build_smart_fallback_group(&config, settings);
    let mut switched_group = false;
    let mut has_smart_group = false;

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups.iter_mut() {
            let Some(group_map) = group.as_mapping_mut() else {
                continue;
            };

            let group_type = group_map.get("type").and_then(Value::as_str);
            has_smart_group = has_smart_group || group_type == Some("smart");
            if !matches!(group_type, Some("url-test" | "load-balance")) {
                continue;
            }

            switched_group = true;
            group_map.insert(Value::String("type".into()), Value::String("smart".into()));
            for key in SMART_AUTO_SWITCH_REMOVED_KEYS {
                group_map.remove(*key);
            }

            insert_smart_group_defaults(group_map, settings);
        }

        if !switched_group
            && !has_smart_group
            && let Some(fallback_group) = fallback_group
        {
            if let Some(fallback_group_name) = fallback_group.get("name").and_then(Value::as_str).map(str::to_owned) {
                prepend_proxy_to_first_selector_group(groups, &fallback_group_name);
            }
            groups.push(Value::Mapping(fallback_group));
        }
    } else if !config.contains_key("proxy-groups")
        && let Some(fallback_group) = fallback_group
    {
        config.insert(
            Value::String("proxy-groups".into()),
            Value::Sequence(vec![Value::Mapping(fallback_group)]),
        );
    }

    config
}

fn prepend_proxy_to_first_selector_group(groups: &mut [Value], proxy_name: &str) {
    for group in groups {
        let Some(group_map) = group.as_mapping_mut() else {
            continue;
        };

        let group_type = group_map.get("type").and_then(Value::as_str);
        if !matches!(group_type, Some("select" | "selector")) {
            continue;
        }

        match group_map.get_mut("proxies") {
            Some(Value::Sequence(proxies)) if !proxies.iter().any(|proxy| proxy.as_str() == Some(proxy_name)) => {
                proxies.insert(0, Value::String(proxy_name.into()));
            }
            Some(Value::Sequence(_)) => {}
            None => {
                group_map.insert(
                    Value::String("proxies".into()),
                    Value::Sequence(vec![Value::String(proxy_name.into())]),
                );
            }
            _ => {}
        }
        break;
    }
}

fn insert_smart_group_defaults(group_map: &mut Mapping, settings: &SmartSettings) {
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

fn build_smart_fallback_group(config: &Mapping, settings: &SmartSettings) -> Option<Mapping> {
    let proxy_names = collect_top_level_proxy_names(config);
    let provider_names = collect_proxy_provider_names(config);
    if proxy_names.is_empty() && provider_names.is_empty() {
        return None;
    }

    let mut group = Mapping::new();
    group.insert(
        Value::String("name".into()),
        Value::String(unique_smart_fallback_group_name(config)),
    );
    group.insert(Value::String("type".into()), Value::String("smart".into()));

    if !proxy_names.is_empty() {
        group.insert(
            Value::String("proxies".into()),
            Value::Sequence(proxy_names.into_iter().map(Value::String).collect()),
        );
    }
    if !provider_names.is_empty() {
        group.insert(
            Value::String("use".into()),
            Value::Sequence(provider_names.into_iter().map(Value::String).collect()),
        );
    }

    let url = settings
        .latency_test_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(FALLBACK_LATENCY_TEST_URL);
    group.insert(Value::String("url".into()), Value::String(url.into()));
    group.insert(
        Value::String("interval".into()),
        Value::Number(FALLBACK_LATENCY_TEST_INTERVAL.into()),
    );
    insert_smart_group_defaults(&mut group, settings);

    Some(group)
}

fn collect_top_level_proxy_names(config: &Mapping) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(Value::Sequence(proxies)) = config.get("proxies") {
        for proxy in proxies {
            match proxy {
                Value::Mapping(map) => {
                    if let Some(name) = map.get("name").and_then(Value::as_str) {
                        push_unique_name(&mut names, name);
                    }
                }
                Value::String(name) => push_unique_name(&mut names, name.as_str()),
                _ => {}
            }
        }
    }

    names
}

fn collect_proxy_provider_names(config: &Mapping) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(Value::Mapping(providers)) = config.get("proxy-providers") {
        for name in providers.keys().filter_map(Value::as_str) {
            push_unique_name(&mut names, name);
        }
    }

    names
}

fn push_unique_name(names: &mut Vec<String>, name: &str) {
    if !name.is_empty() && !names.iter().any(|existing| existing == name) {
        names.push(name.to_owned());
    }
}

fn unique_smart_fallback_group_name(config: &Mapping) -> String {
    let Some(groups) = config.get("proxy-groups").and_then(Value::as_sequence) else {
        return SMART_FALLBACK_GROUP_NAME.to_owned();
    };

    if !proxy_group_name_exists(groups, SMART_FALLBACK_GROUP_NAME) {
        return SMART_FALLBACK_GROUP_NAME.to_owned();
    }

    let mut suffix = 2;
    loop {
        let name = format!("{SMART_FALLBACK_GROUP_NAME} {suffix}");
        if !proxy_group_name_exists(groups, &name) {
            return name;
        }
        suffix += 1;
    }
}

fn proxy_group_name_exists(groups: &[Value], name: &str) -> bool {
    groups.iter().any(|group| {
        group
            .as_mapping()
            .and_then(|group| group.get("name"))
            .and_then(Value::as_str)
            == Some(name)
    })
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

    fn group_count(config: &Mapping) -> usize {
        config
            .get("proxy-groups")
            .and_then(Value::as_sequence)
            .map_or(0, Vec::len)
    }

    fn string_sequence_field<'a>(config: &'a Mapping, index: usize, key: &str) -> Vec<&'a str> {
        group_field(config, index, key)
            .and_then(Value::as_sequence)
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    }

    #[test]
    fn auto_switch_converts_group_and_keeps_health_check_keys() -> Result<(), serde_yaml_ng::Error> {
        let config = config_with_group(
            "  - name: Auto\n    type: url-test\n    proxies: [a]\n    url: http://example.com/204\n    interval: 1800\n    lazy: false\n    expected-status: \"204\"\n    tolerance: 50\n",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("smart"));
        assert_eq!(
            group_field(&result, 0, "url").and_then(Value::as_str),
            Some("http://example.com/204")
        );
        assert_eq!(group_field(&result, 0, "interval").and_then(Value::as_u64), Some(1800));
        assert_eq!(group_field(&result, 0, "lazy").and_then(Value::as_bool), Some(false));
        assert_eq!(
            group_field(&result, 0, "expected-status").and_then(Value::as_str),
            Some("204")
        );
        assert_eq!(group_field(&result, 0, "tolerance"), None);
        Ok(())
    }

    #[test]
    fn auto_switch_adds_fallback_group_from_top_level_proxies() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxies:
  - name: Proxy A
    type: ss
  - name: Proxy B
    type: ss
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            latency_test_url: Some("http://example.com/204".into()),
            policy_priority: Some("Proxy A:0.9".into()),
            prefer_asn: true,
            collect_data: true,
            sample_rate: 0.5,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);
        let expected_sample_rate = serde_yaml_ng::to_value(0.5)?;

        assert_eq!(group_count(&result), 1);
        assert_eq!(
            group_field(&result, 0, "name").and_then(Value::as_str),
            Some("Smart Group")
        );
        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("smart"));
        assert_eq!(string_sequence_field(&result, 0, "proxies"), vec!["Proxy A", "Proxy B"]);
        assert_eq!(group_field(&result, 0, "use"), None);
        assert_eq!(
            group_field(&result, 0, "url").and_then(Value::as_str),
            Some("http://example.com/204")
        );
        assert_eq!(
            group_field(&result, 0, "interval").and_then(Value::as_u64),
            Some(FALLBACK_LATENCY_TEST_INTERVAL)
        );
        assert_eq!(
            group_field(&result, 0, "policy-priority").and_then(Value::as_str),
            Some("Proxy A:0.9")
        );
        assert_eq!(
            group_field(&result, 0, "prefer-asn").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            group_field(&result, 0, "collectdata").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(group_field(&result, 0, "sample-rate"), Some(&expected_sample_rate));
        Ok(())
    }

    #[test]
    fn auto_switch_adds_fallback_group_from_proxy_providers() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxy-providers:
  Airport:
    type: http
    url: http://example.com/provider.yaml
proxy-groups: []
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_count(&result), 1);
        assert_eq!(
            group_field(&result, 0, "name").and_then(Value::as_str),
            Some("Smart Group")
        );
        assert_eq!(group_field(&result, 0, "proxies"), None);
        assert_eq!(string_sequence_field(&result, 0, "use"), vec!["Airport"]);
        Ok(())
    }

    #[test]
    fn auto_switch_prepends_fallback_group_to_first_selector_group() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxies:
  - name: Proxy A
    type: ss
proxy-groups:
  - name: Main
    type: select
    proxies: [DIRECT]
  - name: Backup
    type: selector
    proxies: [DIRECT]
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_count(&result), 3);
        assert_eq!(
            string_sequence_field(&result, 0, "proxies"),
            vec!["Smart Group", "DIRECT"]
        );
        assert_eq!(string_sequence_field(&result, 1, "proxies"), vec!["DIRECT"]);
        assert_eq!(
            group_field(&result, 2, "name").and_then(Value::as_str),
            Some("Smart Group")
        );
        assert_eq!(group_field(&result, 2, "type").and_then(Value::as_str), Some("smart"));
        Ok(())
    }

    #[test]
    fn auto_switch_does_not_add_fallback_when_group_is_converted() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxies:
  - name: Proxy A
    type: ss
proxy-groups:
  - name: Auto
    type: url-test
    proxies: [Proxy A]
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_count(&result), 1);
        assert_eq!(group_field(&result, 0, "name").and_then(Value::as_str), Some("Auto"));
        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("smart"));
        Ok(())
    }

    #[test]
    fn auto_switch_does_not_add_fallback_when_smart_group_exists() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxies:
  - name: Proxy A
    type: ss
proxy-groups:
  - name: Existing Smart
    type: smart
    proxies: [Proxy A]
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_count(&result), 1);
        assert_eq!(
            group_field(&result, 0, "name").and_then(Value::as_str),
            Some("Existing Smart")
        );
        assert_eq!(group_field(&result, 0, "type").and_then(Value::as_str), Some("smart"));
        Ok(())
    }

    #[test]
    fn auto_switch_uses_unique_fallback_group_name() -> Result<(), serde_yaml_ng::Error> {
        let config = serde_yaml_ng::from_str(
            r"
proxies:
  - name: Proxy A
    type: ss
proxy-groups:
  - name: Smart Group
    type: select
    proxies: [Proxy A]
",
        )?;
        let settings = SmartSettings {
            strategy_auto_switch: true,
            ..SmartSettings::default()
        };

        let result = apply_smart_strategy_auto_switch(config, &settings);

        assert_eq!(group_count(&result), 2);
        assert_eq!(
            group_field(&result, 1, "name").and_then(Value::as_str),
            Some("Smart Group 2")
        );
        assert_eq!(group_field(&result, 1, "type").and_then(Value::as_str), Some("smart"));
        assert_eq!(
            string_sequence_field(&result, 0, "proxies"),
            vec!["Smart Group 2", "Proxy A"]
        );
        Ok(())
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

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
];

pub(super) fn apply_core_runtime_settings(config: Mapping, core: Option<&str>, settings: &SmartSettings) -> Mapping {
    if is_smart_core(core) {
        apply_smart_runtime_settings(config, settings)
    } else {
        strip_smart_runtime_settings(config)
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
            group_map.remove("strategy");

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

fn strip_smart_runtime_settings(mut config: Mapping) -> Mapping {
    for key in SMART_TOP_LEVEL_KEYS {
        config.remove(*key);
    }

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups {
            let Some(group_map) = group.as_mapping_mut() else {
                continue;
            };

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

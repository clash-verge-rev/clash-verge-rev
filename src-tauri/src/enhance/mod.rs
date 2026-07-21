mod chain;
pub mod field;
mod merge;
mod script;
pub mod seq;
mod tun;

use self::{
    chain::{AsyncChainItemFrom as _, ChainItem, ChainType},
    field::{use_keys, use_lowercase, use_sort},
    merge::use_merge,
    script::use_script,
    seq::{SeqMap, use_seq},
    tun::use_tun,
};
use crate::utils::dirs;
use crate::{
    config::{Config, IVerge, PrfItem},
    constants,
    utils::tmpl,
};
use anyhow::{Context as _, Result};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};
use tokio::fs;

type ResultLog = Vec<(String, String)>;
#[derive(Debug)]
struct ConfigValues {
    clash_config: Mapping,
    clash_core: Option<String>,
    enable_tun: bool,
    enable_builtin: bool,
    socks_enabled: bool,
    http_enabled: bool,
    enable_dns_settings: bool,
    #[cfg(not(target_os = "windows"))]
    redir_enabled: bool,
    #[cfg(target_os = "linux")]
    tproxy_enabled: bool,
}

#[derive(Debug)]
struct ProfileItems {
    config: Mapping,
    merge_item: ChainItem,
    script_item: ChainItem,
    rules_item: ChainItem,
    proxies_item: ChainItem,
    groups_item: ChainItem,
    global_merge: ChainItem,
    global_script: ChainItem,
    profile_name: String,
}

impl Default for ProfileItems {
    fn default() -> Self {
        Self {
            config: Default::default(),
            profile_name: Default::default(),
            merge_item: ChainItem {
                uid: "".into(),
                data: ChainType::Merge(Mapping::new()),
            },
            script_item: ChainItem {
                uid: "".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            },
            rules_item: ChainItem {
                uid: "".into(),
                data: ChainType::Rules(SeqMap::default()),
            },
            proxies_item: ChainItem {
                uid: "".into(),
                data: ChainType::Proxies(SeqMap::default()),
            },
            groups_item: ChainItem {
                uid: "".into(),
                data: ChainType::Groups(SeqMap::default()),
            },
            global_merge: ChainItem {
                uid: "Merge".into(),
                data: ChainType::Merge(Mapping::new()),
            },
            global_script: ChainItem {
                uid: "Script".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            },
        }
    }
}

async fn chain_item_or_default(item: Option<&PrfItem>, default_item: impl FnOnce() -> ChainItem) -> ChainItem {
    if let Some(item) = item {
        <Option<ChainItem>>::from_async(item).await.unwrap_or_else(default_item)
    } else {
        default_item()
    }
}

async fn get_config_values() -> ConfigValues {
    let clash = Config::clash().await;
    let clash_arc = clash.latest_arc();
    let clash_config = clash_arc.0.clone();
    drop(clash_arc);
    drop(clash);

    let verge = Config::verge().await;

    let verge_arc = verge.latest_arc();
    let IVerge {
        ref enable_tun_mode,
        ref enable_builtin_enhanced,
        ref verge_socks_enabled,
        ref verge_http_enabled,
        ref enable_dns_settings,
        ..
    } = **verge_arc;

    let (clash_core, enable_tun, enable_builtin, socks_enabled, http_enabled, enable_dns_settings) = (
        Some(verge_arc.get_valid_clash_core()),
        enable_tun_mode.unwrap_or(false),
        enable_builtin_enhanced.unwrap_or(true),
        verge_socks_enabled.unwrap_or(false),
        verge_http_enabled.unwrap_or(false),
        enable_dns_settings.unwrap_or(false),
    );

    #[cfg(not(target_os = "windows"))]
    let redir_enabled = verge_arc.verge_redir_enabled.unwrap_or(false);

    #[cfg(target_os = "linux")]
    let tproxy_enabled = verge_arc.verge_tproxy_enabled.unwrap_or(false);

    drop(verge_arc);
    drop(verge);

    ConfigValues {
        clash_config,
        clash_core,
        enable_tun,
        enable_builtin,
        socks_enabled,
        http_enabled,
        enable_dns_settings,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    }
}

#[allow(clippy::cognitive_complexity)]
async fn collect_profile_items() -> Result<ProfileItems> {
    let profiles = Config::profiles().await;
    let profiles_arc = profiles.latest_arc();
    drop(profiles);

    let current_profile_uid = match profiles_arc.get_current().cloned() {
        Some(uid) => uid,
        None => {
            drop(profiles_arc);
            return Ok(ProfileItems::default());
        }
    };

    let current = profiles_arc
        .current_mapping()
        .await
        .with_context(|| format!("failed to read current profile \"{current_profile_uid}\""))?;

    let current_item = match profiles_arc.get_item(&current_profile_uid) {
        Ok(item) => item,
        Err(err) => {
            return Err(err).with_context(|| format!("failed to get current profile \"{current_profile_uid}\""));
        }
    };

    let merge_uid = current_item.current_merge().cloned().unwrap_or_else(|| "Merge".into());
    let script_uid = current_item
        .current_script()
        .cloned()
        .unwrap_or_else(|| "Script".into());
    let rules_uid = current_item.current_rules().cloned().unwrap_or_else(|| "Rules".into());
    let proxies_uid = current_item
        .current_proxies()
        .cloned()
        .unwrap_or_else(|| "Proxies".into());
    let groups_uid = current_item
        .current_groups()
        .cloned()
        .unwrap_or_else(|| "Groups".into());

    let name = current_item.name.clone().unwrap_or_default();

    let (merge_item, script_item, rules_item, proxies_item, groups_item, global_merge, global_script) = tokio::join!(
        chain_item_or_default(profiles_arc.get_item(&merge_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Merge(Mapping::new()),
        },),
        chain_item_or_default(profiles_arc.get_item(&script_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
        },),
        chain_item_or_default(profiles_arc.get_item(&rules_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Rules(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item(&proxies_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Proxies(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item(&groups_uid).ok(), || ChainItem {
            uid: "".into(),
            data: ChainType::Groups(SeqMap::default()),
        },),
        chain_item_or_default(profiles_arc.get_item("Merge").ok(), || ChainItem {
            uid: "Merge".into(),
            data: ChainType::Merge(Mapping::new()),
        },),
        chain_item_or_default(profiles_arc.get_item("Script").ok(), || ChainItem {
            uid: "Script".into(),
            data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
        },),
    );

    drop(profiles_arc);

    Ok(ProfileItems {
        config: current,
        merge_item,
        script_item,
        rules_item,
        proxies_item,
        groups_item,
        global_merge,
        global_script,
        profile_name: name,
    })
}

async fn process_global_items(
    mut config: Mapping,
    mut exists_keys: Vec<String>,
    mut result_map: HashMap<String, ResultLog>,
    global_merge: ChainItem,
    global_script: ChainItem,
    profile_name: &String,
) -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    if let ChainType::Merge(merge) = global_merge.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(&merge, config);
    }

    if let ChainType::Script(script) = global_script.data {
        let mut logs = vec![];
        match use_script(script, config.clone(), profile_name.clone()).await {
            Ok((res_config, res_logs)) => {
                extend_changed_keys(&mut exists_keys, &config, &res_config);
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string().into())),
        }
        result_map.insert(global_script.uid, logs);
    }

    (config, exists_keys, result_map)
}

fn process_seq_items(
    mut config: Mapping,
    rules_item: ChainItem,
    proxies_item: ChainItem,
    groups_item: ChainItem,
) -> Mapping {
    if let ChainType::Rules(rules) = rules_item.data {
        config = use_seq(rules, config, "rules");
    }

    if let ChainType::Proxies(proxies) = proxies_item.data {
        config = use_seq(proxies, config, "proxies");
    }

    if let ChainType::Groups(groups) = groups_item.data {
        config = use_seq(groups, config, "proxy-groups");
    }

    config
}

fn extend_changed_keys(exists_keys: &mut Vec<String>, config: &Mapping, res_config: &Mapping) {
    exists_keys.extend(res_config.iter().filter_map(|(key, value)| {
        if config.get(key) == Some(value) {
            return None;
        }

        key.as_str().map(|key| {
            let mut key: String = key.into();
            key.make_ascii_lowercase();
            key
        })
    }));
}

/// App 权威的顶层控制面键:核心连接、监听端口、UI/托盘开关。
/// 平台键随 cfg 门控;`dns.ipv6` 单独处理。
const CONTROL_PLANE_KEYS: &[&str] = &[
    "external-controller",
    #[cfg(unix)]
    "external-controller-unix",
    #[cfg(windows)]
    "external-controller-pipe",
    "external-controller-cors",
    "secret",
    "mixed-port",
    "socks-port",
    "port",
    #[cfg(not(target_os = "windows"))]
    "redir-port",
    #[cfg(target_os = "linux")]
    "tproxy-port",
    "tun",
    "mode",
    "allow-lan",
    "log-level",
    "ipv6",
    "unified-delay",
];

/// 手动 merge/script 前保存 app 最终控制面值,只记录当前存在的键。
fn snapshot_control_plane(config: &Mapping) -> Mapping {
    let mut snapshot = Mapping::new();
    for &key in CONTROL_PLANE_KEYS {
        let key = Value::from(key);
        if let Some(value) = config.get(&key) {
            snapshot.insert(key, value.clone());
        }
    }
    snapshot
}

/// 手动覆盖后恢复控制面快照;快照缺失的控制面键从最终配置删除。
fn enforce_control_plane(mut config: Mapping, snapshot: Mapping) -> Mapping {
    for &key in CONTROL_PLANE_KEYS {
        let key = Value::from(key);
        if !snapshot.contains_key(&key) {
            config.remove(&key);
        }
    }
    config.extend(snapshot);
    config
}

/// DNS 页权威的嵌套开关;只在 `enable_dns_settings` 时快照。
fn snapshot_dns_ipv6(config: &Mapping) -> Option<Value> {
    config.get("dns")?.get("ipv6").cloned()
}

/// 恢复 `dns.ipv6`,但不创建缺失的 `dns` 块。
fn enforce_dns_ipv6(mut config: Mapping, dns_ipv6: Option<Value>) -> Mapping {
    if let Some(dns_ipv6) = dns_ipv6
        && let Some(Value::Mapping(dns)) = config.get_mut("dns")
    {
        dns.insert(Value::from("ipv6"), dns_ipv6);
    }
    config
}

fn is_loopback_bind_address(addr: &str) -> bool {
    let addr = addr.trim();
    let addr = addr
        .strip_prefix('[')
        .and_then(|addr| addr.strip_suffix(']'))
        .unwrap_or(addr);

    addr.eq_ignore_ascii_case("localhost")
        || addr.parse::<std::net::IpAddr>().is_ok_and(|addr| addr.is_loopback())
        || is_ipv4_shorthand_loopback(addr)
}

fn is_ipv4_shorthand_loopback(addr: &str) -> bool {
    let parts = addr.split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>();

    let Ok(parts) = parts else {
        return false;
    };

    match parts.as_slice() {
        [first, rest] => *first == 127 && *rest <= 0x00ff_ffff,
        [first, second, rest] => *first == 127 && *second <= 0xff && *rest <= 0xffff,
        [first, second, third, fourth] => *first == 127 && *second <= 0xff && *third <= 0xff && *fourth <= 0xff,
        _ => false,
    }
}

fn ensure_lan_bind_address(mut config: Mapping) -> Mapping {
    let allow_lan = config.get("allow-lan").and_then(Value::as_bool).unwrap_or(false);

    if allow_lan
        && config
            .get("bind-address")
            .and_then(Value::as_str)
            .is_some_and(is_loopback_bind_address)
    {
        config.insert(Value::from("bind-address"), Value::from("*"));
    }

    config
}

async fn process_profile_items(
    mut config: Mapping,
    mut exists_keys: Vec<String>,
    mut result_map: HashMap<String, ResultLog>,
    merge_item: ChainItem,
    script_item: ChainItem,
    profile_name: &String,
) -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    if let ChainType::Merge(merge) = merge_item.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(&merge, config);
    }

    if let ChainType::Script(script) = script_item.data {
        let mut logs = vec![];
        match use_script(script, config.clone(), profile_name.clone()).await {
            Ok((res_config, res_logs)) => {
                extend_changed_keys(&mut exists_keys, &config, &res_config);
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string().into())),
        }
        result_map.insert(script_item.uid, logs);
    }

    (config, exists_keys, result_map)
}

async fn merge_default_config(
    mut config: Mapping,
    clash_config: Mapping,
    socks_enabled: bool,
    http_enabled: bool,
    #[cfg(not(target_os = "windows"))] redir_enabled: bool,
    #[cfg(target_os = "linux")] tproxy_enabled: bool,
) -> Mapping {
    for (key, value) in clash_config.into_iter() {
        if key.as_str() == Some("tun") {
            let mut tun = config.get_mut("tun").map_or_else(Mapping::new, |val| {
                val.as_mapping().cloned().unwrap_or_else(Mapping::new)
            });
            let patch_tun = value.as_mapping().cloned().unwrap_or_else(Mapping::new);
            for (key, value) in patch_tun.into_iter() {
                tun.insert(key, value);
            }
            config.insert("tun".into(), tun.into());
        } else {
            if key.as_str() == Some("socks-port") && !socks_enabled {
                config.remove("socks-port");
                continue;
            }
            if key.as_str() == Some("port") && !http_enabled {
                config.remove("port");
                continue;
            }
            #[cfg(target_os = "windows")]
            {
                if key.as_str() == Some("redir-port") {
                    continue;
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                if key.as_str() == Some("redir-port") && !redir_enabled {
                    config.remove("redir-port");
                    continue;
                }
            }
            #[cfg(target_os = "linux")]
            {
                if key.as_str() == Some("tproxy-port") && !tproxy_enabled {
                    config.remove("tproxy-port");
                    continue;
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                if key.as_str() == Some("tproxy-port") {
                    config.remove("tproxy-port");
                    continue;
                }
            }
            // 处理 external-controller 键的开关逻辑
            if key.as_str() == Some("external-controller") {
                let enable_external_controller = Config::verge()
                    .await
                    .latest_arc()
                    .enable_external_controller
                    .unwrap_or(false);

                if enable_external_controller {
                    config.insert(key, value);
                } else {
                    // 如果禁用了外部控制器，设置为空字符串
                    config.insert(key, "".into());
                }
            } else {
                config.insert(key, value);
            }
        }
    }

    config
}

async fn apply_builtin_scripts(mut config: Mapping, clash_core: Option<String>, enable_builtin: bool) -> Mapping {
    if enable_builtin {
        let items: Vec<_> = ChainItem::builtin()
            .into_iter()
            .filter(|(s, _)| s.is_support(clash_core.as_ref()))
            .map(|(_, c)| c)
            .collect();
        for item in items {
            logging!(debug, Type::Core, "run builtin script {}", item.uid);
            if let ChainType::Script(script) = item.data {
                match use_script(script, config.clone(), String::from("")).await {
                    Ok((res_config, _)) => {
                        config = res_config;
                    }
                    Err(err) => {
                        logging!(error, Type::Core, "builtin script error `{err}`");
                    }
                }
            }
        }
    }

    config
}

fn cleanup_proxy_groups(mut config: Mapping) -> Mapping {
    const BUILTIN_POLICIES: &[&str] = &["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

    let proxy_names = config
        .get("proxies")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| match item {
                    Value::Mapping(map) => map
                        .get("name")
                        .and_then(Value::as_str)
                        .map(|name| name.to_owned().into()),
                    Value::String(name) => Some(name.to_owned().into()),
                    _ => None,
                })
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let group_names = config
        .get("proxy-groups")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| {
                    item.as_mapping()
                        .and_then(|map| map.get("name"))
                        .and_then(Value::as_str)
                        .map(std::convert::Into::into)
                })
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let provider_names = config
        .get("proxy-providers")
        .and_then(Value::as_mapping)
        .map(|map| {
            map.keys()
                .filter_map(Value::as_str)
                .map(std::convert::Into::into)
                .collect::<HashSet<String>>()
        })
        .unwrap_or_default();

    let mut allowed_names = proxy_names;
    allowed_names.extend(group_names);
    allowed_names.extend(provider_names.iter().cloned());
    allowed_names.extend(BUILTIN_POLICIES.iter().map(|p| (*p).into()));

    if let Some(Value::Sequence(groups)) = config.get_mut("proxy-groups") {
        for group in groups {
            if let Some(group_map) = group.as_mapping_mut() {
                let mut has_valid_provider = false;

                if let Some(Value::Sequence(uses)) = group_map.get_mut("use") {
                    uses.retain(|provider| match provider {
                        Value::String(name) => {
                            let exists = provider_names.contains(name.as_str());
                            has_valid_provider = has_valid_provider || exists;
                            exists
                        }
                        _ => false,
                    });
                }

                if let Some(Value::Sequence(proxies)) = group_map.get_mut("proxies") {
                    proxies.retain(|proxy| match proxy {
                        Value::String(name) => allowed_names.contains(name.as_str()) || has_valid_provider,
                        _ => true,
                    });
                }
            }
        }
    }

    config
}

/// 当 DNS 处于 fake-ip 模式且启用 IPv6 时，补充缺失的 `fake-ip-range6`，
/// 否则 AAAA 查询无法获得 fake-ip，导致 IPv6 解析失败（见 issue #7373）。
/// 兼容旧版本生成的、缺少该字段的 dns_config.yaml。
fn ensure_fake_ip_range6(dns: &mut Mapping) {
    use serde_yaml_ng::Value;

    let ipv6_enabled = dns.get("ipv6").and_then(|v| v.as_bool()).unwrap_or(false);
    let is_fake_ip = dns
        .get("enhanced-mode")
        .and_then(|v| v.as_str())
        .map(|m| m == "fake-ip")
        .unwrap_or(true);

    // 缺失或为空字符串（可能来自手动编辑的 YAML）时都需要补充
    let range6_missing = dns
        .get("fake-ip-range6")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true);

    if ipv6_enabled && is_fake_ip && range6_missing {
        dns.insert(Value::from("fake-ip-range6"), Value::from("fdfe:dcba:9876::1/64"));
    }
}

async fn apply_dns_settings(mut config: Mapping, enable_dns_settings: bool) -> Mapping {
    if enable_dns_settings && let Ok(app_dir) = dirs::app_home_dir() {
        let dns_path = app_dir.join(constants::files::DNS_CONFIG);

        if dns_path.exists()
            && let Ok(dns_yaml) = fs::read_to_string(&dns_path).await
            && let Ok(dns_config) = serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml)
        {
            if let Some(hosts_value) = dns_config.get("hosts")
                && hosts_value.is_mapping()
            {
                config.insert("hosts".into(), hosts_value.clone());
                logging!(info, Type::Core, "apply hosts configuration");
            }

            if let Some(dns_value) = dns_config.get("dns") {
                if let Some(dns_mapping) = dns_value.as_mapping() {
                    let mut dns_mapping = dns_mapping.clone();
                    ensure_fake_ip_range6(&mut dns_mapping);
                    config.insert("dns".into(), dns_mapping.into());
                    logging!(info, Type::Core, "apply dns_config.yaml (dns section)");
                }
            } else {
                let mut dns_config = dns_config;
                ensure_fake_ip_range6(&mut dns_config);
                config.insert("dns".into(), dns_config.into());
                logging!(info, Type::Core, "apply dns_config.yaml");
            }
        }
    }

    config
}

/// Enhance mode
/// 返回最终订阅、该订阅包含的键、和script执行的结果
pub async fn enhance() -> Result<(Mapping, HashSet<String>, HashMap<String, ResultLog>)> {
    // gather config values
    let cfg_vals = get_config_values().await;
    let ConfigValues {
        clash_config,
        clash_core,
        enable_tun,
        enable_builtin,
        socks_enabled,
        http_enabled,
        enable_dns_settings,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    } = cfg_vals;

    // collect profile items
    let profile = collect_profile_items().await?;
    let config = profile.config;
    let merge_item = profile.merge_item;
    let script_item = profile.script_item;
    let rules_item = profile.rules_item;
    let proxies_item = profile.proxies_item;
    let groups_item = profile.groups_item;
    let global_merge = profile.global_merge;
    let global_script = profile.global_script;
    let profile_name = profile.profile_name;

    let result_map = HashMap::new();

    // 顺序项先于手动覆盖。
    let config = process_seq_items(config, rules_item, proxies_item, groups_item);
    let exists_keys = use_keys(&config).collect::<Vec<_>>();

    // merge default clash config
    let config = merge_default_config(
        config,
        clash_config,
        socks_enabled,
        http_enabled,
        #[cfg(not(target_os = "windows"))]
        redir_enabled,
        #[cfg(target_os = "linux")]
        tproxy_enabled,
    )
    .await;

    // app 生成项先于手动覆盖。
    let config = apply_builtin_scripts(config, clash_core, enable_builtin).await;
    let config = use_tun(config, enable_tun);
    let config = apply_dns_settings(config, enable_dns_settings).await;

    // 手动覆盖前锁定 app 权威字段。
    let control_plane = snapshot_control_plane(&config);
    // DNS 页开启时,仅 `dns.ipv6` 跟随 UI;其余 DNS 字段仍可覆盖。
    let dns_ipv6 = if enable_dns_settings {
        snapshot_dns_ipv6(&config)
    } else {
        None
    };

    // 全局手动覆盖。
    let (config, exists_keys, result_map) = process_global_items(
        config,
        exists_keys,
        result_map,
        global_merge,
        global_script,
        &profile_name,
    )
    .await;

    // 当前 profile 手动覆盖。
    let (config, exists_keys, result_map) =
        process_profile_items(config, exists_keys, result_map, merge_item, script_item, &profile_name).await;

    // 手动覆盖后恢复 app 权威字段。
    let config = enforce_control_plane(config, control_plane);
    let config = enforce_dns_ipv6(config, dns_ipv6);
    let config = ensure_lan_bind_address(config);

    let config = cleanup_proxy_groups(config);
    let config = use_sort(config);

    let mut exists_keys_set = HashSet::new();
    exists_keys_set.extend(exists_keys);

    Ok((config, exists_keys_set, result_map))
}

#[allow(clippy::expect_used)]
#[cfg(test)]
mod tests {
    use super::{
        ChainItem, ChainType, cleanup_proxy_groups, ensure_lan_bind_address, process_global_items,
        process_profile_items, use_keys,
    };
    use std::collections::HashMap;

    fn mapping(yaml: &str) -> serde_yaml_ng::Mapping {
        serde_yaml_ng::from_str(yaml).expect("test config should be valid")
    }

    #[tokio::test]
    async fn manual_overrides_follow_expected_priority() {
        let mut config = mapping(
            r"{global-merge-wins: other, global-script-wins: other, profile-merge-wins: other,
               profile-script-wins: other, nested: {winner: other}, dns: {enable: true}, tun: {enable: true}}",
        );
        let exists_keys = use_keys(&config).collect();
        config.insert("application-only".into(), true.into());

        let global_merge = ChainItem {
            uid: "Merge".into(),
            data: ChainType::Merge(mapping(
                r"{global-merge-wins: global-merge, global-script-wins: global-merge,
                   profile-merge-wins: global-merge, profile-script-wins: global-merge,
                   nested: {winner: global-merge}, dns: {enable: false}, tun: {enable: false}}",
            )),
        };
        let global_script = ChainItem::to_script(
            "Script",
            r#"function main(config) {
              config["global-script-wins"] = "global-script";
              config["profile-merge-wins"] = "global-script";
              config["profile-script-wins"] = "global-script";
              config.nested.winner = "global-script";
              return config;
            }"#,
        );
        let profile_merge = ChainItem {
            uid: "profile-merge".into(),
            data: ChainType::Merge(mapping(
                r"{profile-merge-wins: profile-merge, profile-script-wins: profile-merge,
                   nested: {winner: profile-merge}}",
            )),
        };
        let profile_script = ChainItem::to_script(
            "profile-script",
            r#"function main(config) {
              config["profile-script-wins"] = "profile-script";
              config.nested.winner = "profile-script";
              return config;
            }"#,
        );

        let profile_name = "test-profile".into();
        let (config, exists_keys, result_map) = process_global_items(
            config,
            exists_keys,
            HashMap::new(),
            global_merge,
            global_script,
            &profile_name,
        )
        .await;
        let (config, exists_keys, _) = process_profile_items(
            config,
            exists_keys,
            result_map,
            profile_merge,
            profile_script,
            &profile_name,
        )
        .await;

        let string_value = |key| config.get(key).and_then(serde_yaml_ng::Value::as_str);
        assert_eq!(string_value("global-merge-wins"), Some("global-merge"));
        assert_eq!(string_value("global-script-wins"), Some("global-script"));
        assert_eq!(string_value("profile-merge-wins"), Some("profile-merge"));
        assert_eq!(string_value("profile-script-wins"), Some("profile-script"));
        assert_eq!(
            config
                .get("nested")
                .and_then(|value| value.get("winner"))
                .and_then(serde_yaml_ng::Value::as_str),
            Some("profile-script")
        );
        assert!(!exists_keys.contains(&"application-only".into()));
    }

    #[test]
    fn control_plane_survives_manual_overrides() {
        let app_config = mapping(
            r#"{external-controller: "",
                external-controller-cors: {allow-origins: ["app-only"]},
                mixed-port: 7890, socks-port: 7891, secret: "app-secret", mode: rule, allow-lan: false,
                log-level: info, ipv6: false, unified-delay: true,
                dns: {proxy-server-nameserver: ["1.1.1.1"]}}"#,
        );
        let snapshot = super::snapshot_control_plane(&app_config);

        let hijacked = mapping(
            r#"{external-controller: "0.0.0.0:9090",
                external-controller-cors: {allow-origins: ["*"]},
                mixed-port: 1080, socks-port: 1080, secret: "hijacked", mode: global, allow-lan: true,
                log-level: debug, ipv6: true, unified-delay: false,
                dns: {proxy-server-nameserver: ["8.8.8.8"]}}"#,
        );

        let result = super::enforce_control_plane(hijacked, snapshot);

        let as_str = |key| result.get(key).and_then(serde_yaml_ng::Value::as_str);
        assert_eq!(as_str("external-controller"), Some(""));
        assert_eq!(
            result.get("mixed-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7890)
        );
        assert_eq!(
            result.get("socks-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7891)
        );
        assert_eq!(
            result
                .get("external-controller-cors")
                .and_then(|value| value.get("allow-origins"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("app-only")
        );
        assert_eq!(as_str("secret"), Some("app-secret"));
        assert_eq!(as_str("mode"), Some("rule"));
        assert_eq!(
            result.get("allow-lan").and_then(serde_yaml_ng::Value::as_bool),
            Some(false)
        );
        assert_eq!(as_str("log-level"), Some("info"));
        assert_eq!(result.get("ipv6").and_then(serde_yaml_ng::Value::as_bool), Some(false));
        assert_eq!(
            result.get("unified-delay").and_then(serde_yaml_ng::Value::as_bool),
            Some(true)
        );

        // DNS 数据面不属于顶层控制面。
        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("8.8.8.8")
        );
    }

    #[test]
    fn lan_bind_address_loopback_is_widened() {
        for bind_address in [
            "localhost",
            "127.0.0.1",
            "127.0.0.2",
            "127.1",
            "::1",
            "[::1]",
            "0:0:0:0:0:0:0:1",
        ] {
            let result = ensure_lan_bind_address(mapping(&format!(
                r#"{{allow-lan: true, bind-address: "{bind_address}"}}"#
            )));

            assert_eq!(
                result.get("bind-address").and_then(serde_yaml_ng::Value::as_str),
                Some("*"),
                "bind-address {bind_address} should be widened"
            );
        }
    }

    #[test]
    fn lan_bind_address_preserves_custom_or_disabled() {
        let custom = ensure_lan_bind_address(mapping(r#"{allow-lan: true, bind-address: "192.168.1.2"}"#));
        assert_eq!(
            custom.get("bind-address").and_then(serde_yaml_ng::Value::as_str),
            Some("192.168.1.2")
        );

        let disabled = ensure_lan_bind_address(mapping(r#"{allow-lan: false, bind-address: "127.0.0.1"}"#));
        assert_eq!(
            disabled.get("bind-address").and_then(serde_yaml_ng::Value::as_str),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn control_plane_removes_reenabled_disabled_port() {
        let app_config = mapping(r"{mixed-port: 7890, mode: rule}");
        let snapshot = super::snapshot_control_plane(&app_config);

        let hijacked = mapping(r"{mixed-port: 7890, mode: rule, socks-port: 1080}");
        let result = super::enforce_control_plane(hijacked, snapshot);

        assert!(!result.contains_key("socks-port"));
        assert_eq!(
            result.get("mixed-port").and_then(serde_yaml_ng::Value::as_u64),
            Some(7890)
        );
    }

    #[test]
    fn dns_ipv6_follows_ui_but_other_dns_stays_overridable() {
        let app_config = mapping(r#"{dns: {ipv6: false, proxy-server-nameserver: ["1.1.1.1"]}}"#);
        let dns_ipv6 = super::snapshot_dns_ipv6(&app_config);

        let hijacked = mapping(r#"{dns: {ipv6: true, proxy-server-nameserver: ["8.8.8.8"]}}"#);
        let result = super::enforce_dns_ipv6(hijacked, dns_ipv6);

        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("ipv6"))
                .and_then(serde_yaml_ng::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            result
                .get("dns")
                .and_then(|value| value.get("proxy-server-nameserver"))
                .and_then(serde_yaml_ng::Value::as_sequence)
                .and_then(|seq| seq.first())
                .and_then(serde_yaml_ng::Value::as_str),
            Some("8.8.8.8")
        );
    }

    #[test]
    fn snapshot_control_plane_skips_absent_keys() {
        let app_config = mapping(r"{mode: rule, mixed-port: 7890}");
        let snapshot = super::snapshot_control_plane(&app_config);
        assert!(snapshot.contains_key("mode"));
        assert!(snapshot.contains_key("mixed-port"));
        assert!(!snapshot.contains_key("secret"));
        assert!(!snapshot.contains_key("allow-lan"));
    }

    #[test]
    fn remove_missing_proxies_from_groups() {
        let config_str = r#"
proxies:
  - name: "alive-node"
    type: ss
proxy-groups:
  - name: "manual"
    type: select
    proxies:
      - "alive-node"
      - "missing-node"
      - "DIRECT"
  - name: "nested"
    type: select
    proxies:
      - "manual"
      - "ghost"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let manual_proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("manual proxies should be a sequence");

        assert_eq!(manual_proxies.len(), 2);
        assert!(manual_proxies.iter().any(|p| p.as_str() == Some("alive-node")));
        assert!(manual_proxies.iter().any(|p| p.as_str() == Some("DIRECT")));

        let nested_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("nested"))
            .and_then(|group| group.as_mapping())
            .expect("nested group should exist");

        let nested_proxies = nested_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("nested proxies should be a sequence");

        assert_eq!(nested_proxies.len(), 1);
        assert_eq!(nested_proxies[0].as_str(), Some("manual"));
    }

    #[test]
    fn keep_provider_backed_groups_intact() {
        let config_str = r#"
proxy-providers:
  providerA:
    type: http
    url: https://example.com
    path: ./providerA.yaml
proxies: []
proxy-groups:
  - name: "manual"
    type: select
    use:
      - "providerA"
      - "ghostProvider"
    proxies:
      - "dynamic-node"
      - "DIRECT"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let uses = manual_group
            .get("use")
            .and_then(|v| v.as_sequence())
            .expect("use should be a sequence");
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].as_str(), Some("providerA"));

        let proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 2);
        assert!(proxies.iter().any(|p| p.as_str() == Some("dynamic-node")));
        assert!(proxies.iter().any(|p| p.as_str() == Some("DIRECT")));
    }

    #[test]
    fn prune_invalid_provider_and_proxies_without_provider() {
        let config_str = r#"
proxy-groups:
  - name: "manual"
    type: select
    use:
      - "ghost-provider"
    proxies:
      - "ghost-node"
      - "DIRECT"
"#;

        let mut config: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(config_str).expect("Failed to parse test yaml");
        config = cleanup_proxy_groups(config);

        let groups = config
            .get("proxy-groups")
            .and_then(|v| v.as_sequence())
            .cloned()
            .expect("proxy-groups should be a sequence");

        let manual_group = groups
            .iter()
            .find(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some("manual"))
            .and_then(|group| group.as_mapping())
            .expect("manual group should exist");

        let uses = manual_group
            .get("use")
            .and_then(|v| v.as_sequence())
            .expect("use should be a sequence");
        assert_eq!(uses.len(), 0);

        let proxies = manual_group
            .get("proxies")
            .and_then(|v| v.as_sequence())
            .expect("proxies should be a sequence");
        assert_eq!(proxies.len(), 1);
        assert_eq!(proxies[0].as_str(), Some("DIRECT"));
    }
}

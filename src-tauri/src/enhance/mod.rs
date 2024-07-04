mod chain;
pub mod field;
mod merge;
mod script;
pub mod seq;
mod tun;

use self::chain::*;
use self::field::*;
use self::merge::*;
use self::script::*;
use self::seq::*;
use self::tun::*;
use crate::config::Config;
use crate::utils::tmpl;
use serde_yaml::Mapping;
use std::collections::HashMap;
use std::collections::HashSet;

type ResultLog = Vec<(String, String)>;

/// Enhance mode
/// 返回最终订阅、该订阅包含的键、和script执行的结果
pub async fn enhance() -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    // config.yaml 的订阅
    let clash_config = { Config::clash().latest().0.clone() };

    let (clash_core, enable_tun, enable_builtin, socks_enabled, http_enabled) = {
        let verge = Config::verge();
        let verge = verge.latest();
        (
            verge.clash_core.clone(),
            verge.enable_tun_mode.unwrap_or(false),
            verge.enable_builtin_enhanced.unwrap_or(true),
            verge.verge_socks_enabled.unwrap_or(false),
            verge.verge_http_enabled.unwrap_or(false),
        )
    };
    #[cfg(not(target_os = "windows"))]
    let redir_enabled = {
        let verge = Config::verge();
        let verge = verge.latest();
        verge.verge_redir_enabled.unwrap_or(false)
    };
    #[cfg(target_os = "linux")]
    let tproxy_enabled = {
        let verge = Config::verge();
        let verge = verge.latest();
        verge.verge_tproxy_enabled.unwrap_or(false)
    };

    // 从profiles里拿东西
    let (
        mut config,
        merge_item,
        script_item,
        rules_item,
        proxies_item,
        groups_item,
        global_merge,
        global_script,
        profile_name,
    ) = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();

        let current = profiles.current_mapping().unwrap_or_default();
        let merge = profiles
            .get_item(&profiles.current_merge().unwrap_or_default())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "".into(),
                data: ChainType::Merge(Mapping::new()),
            });
        let script = profiles
            .get_item(&profiles.current_script().unwrap_or_default())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            });
        let rules = profiles
            .get_item(&profiles.current_rules().unwrap_or_default())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "".into(),
                data: ChainType::Rules(SeqMap::default()),
            });
        let proxies = profiles
            .get_item(&profiles.current_proxies().unwrap_or_default())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "".into(),
                data: ChainType::Proxies(SeqMap::default()),
            });
        let groups = profiles
            .get_item(&profiles.current_groups().unwrap_or_default())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "".into(),
                data: ChainType::Groups(SeqMap::default()),
            });

        let global_merge = profiles
            .get_item(&"Merge".to_string())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "Merge".into(),
                data: ChainType::Merge(Mapping::new()),
            });

        let global_script = profiles
            .get_item(&"Script".to_string())
            .ok()
            .and_then(<Option<ChainItem>>::from)
            .unwrap_or_else(|| ChainItem {
                uid: "Script".into(),
                data: ChainType::Script(tmpl::ITEM_SCRIPT.into()),
            });

        let name = profiles
            .get_item(&profiles.get_current().unwrap_or_default())
            .ok()
            .and_then(|item| item.name.clone())
            .unwrap_or_default();

        (
            current,
            merge,
            script,
            rules,
            proxies,
            groups,
            global_merge,
            global_script,
            name,
        )
    };

    let mut result_map = HashMap::new(); // 保存脚本日志
    let mut exists_keys = use_keys(&config); // 保存出现过的keys

    // 全局Merge和Script
    if let ChainType::Merge(merge) = global_merge.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(merge, config.to_owned());
    }

    if let ChainType::Script(script) = global_script.data {
        let mut logs = vec![];

        match use_script(script, config.to_owned(), profile_name.to_owned()) {
            Ok((res_config, res_logs)) => {
                exists_keys.extend(use_keys(&res_config));
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string())),
        }

        result_map.insert(global_script.uid, logs);
    }

    // 订阅关联的Merge、Script、Rules、Proxies、Groups
    if let ChainType::Rules(rules) = rules_item.data {
        config = use_seq(rules, config.to_owned(), "rules");
    }

    if let ChainType::Proxies(proxies) = proxies_item.data {
        config = use_seq(proxies, config.to_owned(), "proxies");
    }

    if let ChainType::Groups(groups) = groups_item.data {
        config = use_seq(groups, config.to_owned(), "proxy-groups");
    }

    if let ChainType::Merge(merge) = merge_item.data {
        exists_keys.extend(use_keys(&merge));
        config = use_merge(merge, config.to_owned());
    }

    if let ChainType::Script(script) = script_item.data {
        let mut logs = vec![];

        match use_script(script, config.to_owned(), profile_name.to_owned()) {
            Ok((res_config, res_logs)) => {
                exists_keys.extend(use_keys(&res_config));
                config = res_config;
                logs.extend(res_logs);
            }
            Err(err) => logs.push(("exception".into(), err.to_string())),
        }

        result_map.insert(script_item.uid, logs);
    }

    // 合并默认的config
    for (key, value) in clash_config.into_iter() {
        if key.as_str() == Some("tun") {
            let mut tun = config.get_mut("tun").map_or(Mapping::new(), |val| {
                val.as_mapping().cloned().unwrap_or(Mapping::new())
            });
            let patch_tun = value.as_mapping().cloned().unwrap_or(Mapping::new());
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
            config.insert(key, value);
        }
    }

    // 内建脚本最后跑
    if enable_builtin {
        ChainItem::builtin()
            .into_iter()
            .filter(|(s, _)| s.is_support(clash_core.as_ref()))
            .map(|(_, c)| c)
            .for_each(|item| {
                log::debug!(target: "app", "run builtin script {}", item.uid);
                if let ChainType::Script(script) = item.data {
                    match use_script(script, config.to_owned(), "".to_string()) {
                        Ok((res_config, _)) => {
                            config = res_config;
                        }
                        Err(err) => {
                            log::error!(target: "app", "builtin script error `{err}`");
                        }
                    }
                }
            });
    }

    config = use_tun(config, enable_tun).await;
    config = use_sort(config);

    let mut exists_set = HashSet::new();
    exists_set.extend(exists_keys);
    exists_keys = exists_set.into_iter().collect();

    (config, exists_keys, result_map)
}

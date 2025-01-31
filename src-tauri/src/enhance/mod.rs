mod chain;
pub mod field;
mod merge;
mod script;
mod tun;

use self::chain::*;
use self::field::*;
use self::merge::*;
use self::script::*;
use self::tun::*;
use crate::config::Config;
use crate::config::ProfileType;
use crate::utils::dirs::app_home_dir;
use anyhow::bail;
use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;
use serde_yaml::Mapping;
use serde_yaml::Value;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::PathBuf;

type ResultLog = Vec<LogMessage>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogMessage {
    method: String,
    data: Vec<String>,
    exception: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub config: Mapping,
    pub logs: HashMap<String, ResultLog>,
}

pub fn generate_rule_providers(mut config: Mapping) -> Mapping {
    let profiles = Config::profiles();
    let mut profiles = profiles.latest();
    let rp_key = Value::from("rule-providers");
    if !config.contains_key(&rp_key) {
        let _ = profiles.set_rule_providers_path(HashMap::new());
        return config;
    }
    let rp_val = config.get(&rp_key);
    let mut rp_val = rp_val.map_or(Mapping::new(), |val| {
        val.as_mapping().cloned().unwrap_or(Mapping::new())
    });
    let mut absolute_path_map: HashMap<String, PathBuf> = HashMap::new();
    for (key, value) in rp_val.iter_mut() {
        let name = key.as_str().unwrap();
        let val_map = value.as_mapping_mut().unwrap();
        let path_key = Value::from("path");
        let rp_format = val_map.get(Value::from("format")).cloned();
        if rp_format.is_none() {
            val_map.insert(Value::from("format"), Value::from("yaml"));
        }
        let format_val = rp_format.as_ref().map_or("yaml", |v| v.as_str().unwrap());
        if let Some(path) = val_map.get(&path_key) {
            let path = path.as_str().unwrap();
            let absolute_path = app_home_dir().unwrap().join(&path);
            absolute_path_map.insert(name.into(), absolute_path);
        } else {
            // no path value, set default path
            let path = format!("./rules/{name}.{}", format_val);
            let absolute_path = app_home_dir().unwrap().join(&path.trim_start_matches("./"));
            val_map.insert(path_key, Value::from(path));
            absolute_path_map.insert(name.into(), absolute_path);
        }
    }
    let _ = profiles.set_rule_providers_path(absolute_path_map);
    config.insert(rp_key, Value::from(rp_val));
    config
}

/// Enhance mode
/// 返回最终订阅、该订阅包含的键、和script执行的结果
pub fn enhance() -> (Mapping, Vec<String>, HashMap<String, ResultLog>) {
    // config.yaml 的订阅
    let clash_config = { Config::clash().latest().0.clone() };

    let (clash_core, enable_builtin) = {
        let verge = Config::verge();
        let verge = verge.latest();
        (
            verge.clash_core.clone(),
            verge.enable_builtin_enhanced.unwrap_or(true),
        )
    };
    // 从profiles里拿东西
    let (mut config, chain) = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();

        let current = profiles.current_mapping().unwrap_or_default();

        let chain = match profiles.chain.as_ref() {
            Some(chain) => chain
                .iter()
                .filter_map(|uid| profiles.get_item(uid).ok())
                .filter_map(<Option<ChainItem>>::from)
                .collect::<Vec<ChainItem>>(),
            None => vec![],
        };

        (current, chain)
    };

    let mut result_map = HashMap::new(); // 保存脚本日志
    let mut exists_keys = use_keys(&config); // 保存出现过的keys

    // 处理用户的 profile
    chain.into_iter().for_each(|item| match item.data {
        ChainType::Merge(merge) => {
            exists_keys.extend(use_keys(&merge));
            config = use_merge(merge, config.to_owned());
        }
        ChainType::Script(script) => {
            let mut logs = vec![];

            match use_script(script, config.to_owned()) {
                Ok((res_config, res_logs)) => {
                    exists_keys.extend(use_keys(&res_config));
                    config = res_config;
                    logs.extend(res_logs);
                }
                Err(err) => logs.push(LogMessage {
                    method: "error".into(),
                    data: vec![err.to_string()],
                    exception: Some(err.to_string()),
                }),
            }

            result_map.insert(item.uid, logs);
        }
    });

    // 合并 verge 配置的 clash 配置
    for (key, value) in clash_config.into_iter() {
        config.insert(key, value);
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
                    match use_script(script, config.to_owned()) {
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

    let enable_tun = Config::clash().latest().get_enable_tun();
    config = use_tun(config, enable_tun);
    config = use_sort(config);
    config = generate_rule_providers(config);

    let mut exists_set = HashSet::new();
    exists_set.extend(exists_keys);
    exists_keys = exists_set.into_iter().collect::<Vec<String>>();

    (config, exists_keys, result_map)
}

pub fn get_pre_merge_result(modified_chain_id: String) -> Result<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let mut config = profiles.current_mapping().unwrap().clone();
    // let mut modified_chain_is_running = false;
    let chain = match profiles.chain.as_ref() {
        Some(chain) => {
            let index = chain.iter().position(|v| *v == modified_chain_id);
            let new_chain = match index {
                Some(index) => {
                    // modified_chain_is_running = true;
                    chain[..index].to_vec()
                }
                None => chain.to_vec(),
            };
            new_chain
                .iter()
                .filter_map(|uid| profiles.get_item(uid).ok())
                .filter_map(<Option<ChainItem>>::from)
                .collect::<Vec<ChainItem>>()
        }
        None => vec![],
    };

    let mut result_map = HashMap::new(); // 保存脚本日志

    chain.into_iter().for_each(|item| match item.data {
        ChainType::Merge(merge) => {
            // exists_keys.extend(use_keys(&merge));
            config = use_merge(merge, config.to_owned());
        }
        ChainType::Script(script) => {
            let mut logs = vec![];

            match use_script(script, config.to_owned()) {
                Ok((res_config, res_logs)) => {
                    // exists_keys.extend(use_keys(&res_config));
                    config = res_config;
                    logs.extend(res_logs);
                }
                Err(err) => logs.push(LogMessage {
                    method: "error".into(),
                    data: vec![err.to_string()],
                    exception: Some(err.to_string()),
                }),
            }

            result_map.insert(item.uid, logs);
        }
    });

    // 排序
    config = use_sort(config);

    Ok(MergeResult {
        config,
        logs: result_map,
    })
}

pub fn test_merge_chain(modified_chain_id: String, content: String) -> Result<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let running_chains = profiles.chain.clone().unwrap_or_default();
    let should_build_final_config = running_chains[running_chains.len() - 1] == modified_chain_id;

    let MergeResult {
        mut config,
        logs: _,
    } = get_pre_merge_result(modified_chain_id.clone())?;

    let mut result_map = HashMap::new(); // 保存脚本日志
    let mut exists_keys = use_keys(&config); // 保存出现过的keys

    let profile_item = profiles.get_item(&modified_chain_id)?;
    let chain_type = profile_item.itype.as_ref().unwrap();
    match chain_type {
        ProfileType::Merge => {
            let yaml_content = serde_yaml::from_str::<Value>(&content)
                .unwrap()
                .as_mapping()
                .unwrap()
                .clone();
            config = use_merge(yaml_content, config.to_owned());
        }
        ProfileType::Script => {
            let mut logs = vec![];
            match use_script(content, config.to_owned()) {
                Ok((res_config, res_logs)) => {
                    exists_keys.extend(use_keys(&res_config));
                    config = res_config;
                    logs.extend(res_logs);
                }
                Err(err) => logs.push(LogMessage {
                    method: "error".into(),
                    data: vec![err.to_string()],
                    exception: Some(err.to_string()),
                }),
            }
            result_map.insert(modified_chain_id.to_string(), logs);
        }
        _ => {
            bail!("unsupported chain type");
        }
    };

    if should_build_final_config {
        // 内建脚本最后跑
        let (clash_core, enable_builtin) = {
            let verge = Config::verge();
            let verge = verge.latest();
            (
                verge.clash_core.clone(),
                verge.enable_builtin_enhanced.unwrap_or(true),
            )
        };
        if enable_builtin {
            ChainItem::builtin()
                .into_iter()
                .filter(|(s, _)| s.is_support(clash_core.as_ref()))
                .map(|(_, c)| c)
                .for_each(|item| {
                    if let ChainType::Script(script) = item.data {
                        match use_script(script, config.to_owned()) {
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

        //合并 verge 接管的配置
        let clash_config = { Config::clash().latest().0.clone() };
        for (key, value) in clash_config.into_iter() {
            config.insert(key, value);
        }

        let enable_tun = Config::clash().latest().get_enable_tun();
        config = use_tun(config, enable_tun);
        config = use_sort(config);
        config = generate_rule_providers(config);
    }

    Ok(MergeResult {
        config,
        logs: result_map,
    })
}

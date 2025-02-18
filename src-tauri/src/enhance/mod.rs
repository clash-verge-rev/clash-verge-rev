pub mod chain;
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
use crate::config::EnableFilter;
use crate::config::ProfileType;
use crate::core::CoreManager;
use crate::utils::dirs;
use anyhow::anyhow;
use anyhow::bail;
use anyhow::Result;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde::Serialize;
use serde_yaml::Mapping;
use serde_yaml::Value;
use std::collections::HashMap;
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
            let absolute_path = dirs::app_home_dir().unwrap().join(path);
            absolute_path_map.insert(name.into(), absolute_path);
        } else {
            // no path value, set default path
            let path = format!("./rules/{name}.{}", format_val);
            let absolute_path = dirs::app_home_dir()
                .unwrap()
                .join(path.trim_start_matches("./"));
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
pub fn enhance() -> (Mapping, HashMap<String, ResultLog>) {
    // config.yaml 的订阅
    let clash_config = { Config::clash().latest().0.clone() };

    // 从profiles里拿东西
    let (mut config, global_chain, profile_chain) = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let current = profiles.current_mapping().unwrap_or_default();
        let current_uid = profiles.get_current();

        // chain
        let global_chain = profiles.get_profile_chains(None, EnableFilter::Enable);
        let profile_chain = profiles.get_profile_chains(current_uid, EnableFilter::Enable);
        (current, global_chain, profile_chain)
    };

    // 保存脚本日志
    let mut result_map = HashMap::new();

    // global chain
    for chain in global_chain {
        match chain.excute(config.clone()) {
            Ok(res) => {
                config = res.config;
                if let Some(logs) = res.logs {
                    result_map.extend(logs);
                }
            }
            Err(e) => {
                log::error!(target: "app", "global chain [{:?}] excute failed, error: {:?}", chain.uid, e);
            }
        }
    }

    // profile chain
    for chain in profile_chain {
        match chain.excute(config.clone()) {
            Ok(res) => {
                config = res.config;
                if let Some(logs) = res.logs {
                    result_map.extend(logs);
                }
            }
            Err(e) => {
                log::error!(target: "app", "profile chain [{:?}] excute failed, error: {:?}", chain.uid, e);
            }
        }
    }

    // 合并 verge 配置的 clash 配置
    for (key, value) in clash_config.into_iter() {
        config.insert(key, value);
    }

    let enable_tun = Config::clash().latest().get_enable_tun();
    config = use_tun(config, enable_tun);
    config = use_sort(config);
    config = generate_rule_providers(config);

    (config, result_map)
}

pub fn get_pre_merge_result(
    profile_uid: Option<String>,
    modified_uid: String,
) -> Result<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let mut config = profiles.current_mapping()?.clone();

    // 保存脚本日志
    let mut result_map = HashMap::new();

    match profile_uid {
        Some(profile_uid) => {
            // change current config mapping to profile mapping
            config = profiles.get_profile_mapping(&profile_uid)?.clone();

            // excute all enabled global chain
            let global_chain = profiles.get_profile_chains(None, EnableFilter::Enable);
            for chain in global_chain {
                match chain.excute(config.clone()) {
                    Ok(res) => {
                        config = res.config;
                        if let Some(logs) = res.logs {
                            result_map.extend(logs);
                        }
                    }
                    Err(e) => {
                        log::error!(target: "app", "global chain [{:?}] excute failed, error: {:?}", chain.uid, e);
                    }
                }
            }
            // get new profile chain, index form 0 to modified chain index.
            let profile_chain = {
                let chain = profiles.get_profile_chains(Some(profile_uid), EnableFilter::Enable);
                match chain.iter().position(|v| *v.uid == modified_uid) {
                    Some(index) => chain[..index].to_vec(),
                    None => chain,
                }
            };
            // execute new profile chain
            for chain in profile_chain {
                match chain.excute(config.clone()) {
                    Ok(res) => {
                        config = res.config;
                        if let Some(logs) = res.logs {
                            result_map.extend(logs);
                        }
                    }
                    Err(e) => {
                        log::error!(target: "app", "profile chain [{:?}] excute failed, error: {:?}", chain.uid, e);
                    }
                }
            }
        }
        None => {
            let global_chain = match profiles.chain.as_ref() {
                Some(chain) => {
                    let new_chain = match chain.iter().position(|v| *v == modified_uid) {
                        Some(index) => chain[..index].to_vec(),
                        None => chain.to_vec(),
                    };
                    new_chain
                        .iter()
                        .filter_map(|uid| profiles.get_item(uid).cloned().ok())
                        .filter_map(<Option<ChainItem>>::from)
                        .collect::<Vec<ChainItem>>()
                }
                None => vec![],
            };
            // global chain
            for chain in global_chain {
                match chain.excute(config.clone()) {
                    Ok(res) => {
                        config = res.config;
                        if let Some(logs) = res.logs {
                            result_map.extend(logs);
                        }
                    }
                    Err(e) => {
                        log::error!(target: "app", "global chain [{:?}] excute failed, error: {:?}", chain.uid, e);
                    }
                }
            }
        }
    };
    // 排序
    config = use_sort(config);
    Ok(MergeResult {
        config,
        logs: result_map,
    })
}

pub async fn test_merge_chain(
    profile_uid: Option<String>,
    modified_uid: String,
    content: String,
) -> Result<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let running_chains = profiles.chain.clone().unwrap_or_default();
    let should_build_final_config = running_chains[running_chains.len() - 1] == modified_uid;
    // 保存脚本日志
    let mut result_map = HashMap::new();

    let MergeResult { mut config, logs } = get_pre_merge_result(profile_uid, modified_uid.clone())?;
    result_map.extend(logs);

    let profile_item = profiles.get_item(&modified_uid)?;
    let chain_type = profile_item.itype.as_ref().unwrap();
    match chain_type {
        ProfileType::Merge => {
            let yaml_content = serde_yaml::from_str::<Value>(&content)?
                .as_mapping()
                .ok_or_else(|| anyhow!("invalid yaml content"))?
                .clone();
            config = use_merge(yaml_content, config.to_owned());
        }
        ProfileType::Script => {
            let mut logs = vec![];
            match use_script(content, config.to_owned()) {
                Ok((res_config, res_logs)) => {
                    config = res_config;
                    logs.extend(res_logs);
                }
                Err(err) => logs.push(LogMessage {
                    method: "error".into(),
                    data: vec![err.to_string()],
                    exception: Some(err.to_string()),
                }),
            }
            result_map.insert(modified_uid.to_string(), logs);
        }
        _ => {
            bail!("unsupported chain type");
        }
    };

    let config_str = serde_yaml::to_string(&config)?;
    let check_config = BASE64_STANDARD.encode(config_str);
    CoreManager::global().check_config(&check_config).await?;

    if should_build_final_config {
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
    // 排序
    config = use_sort(config);
    Ok(MergeResult {
        config,
        logs: result_map,
    })
}

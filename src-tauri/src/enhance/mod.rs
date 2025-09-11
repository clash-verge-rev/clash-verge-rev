pub mod chain;
pub mod field;
mod merge;
mod script;
mod tun;

use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use self::{chain::*, field::*, merge::*, script::*, tun::*};
use crate::{
    any_err,
    config::{Config, ConfigType, EnableFilter, ProfileType},
    core::CoreManager,
    error::{AppError, AppResult},
    utils::dirs,
};

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
    let mut profiles = profiles.latest_mut();
    let rp_key = Value::from("rule-providers");

    if !config.contains_key(&rp_key) {
        profiles.set_rule_providers_path(HashMap::new());
        return config;
    }

    let rp_val = config.get(&rp_key);
    let mut rp_val = rp_val.map_or(Mapping::new(), |val| val.as_mapping().cloned().unwrap_or_default());
    let mut absolute_path_map: HashMap<String, PathBuf> = HashMap::new();
    for (key, value) in rp_val.iter_mut() {
        let name = key.as_str().unwrap();
        let val_map = value.as_mapping_mut().unwrap();
        let path_key = Value::from("path");

        // add format
        let format_key = Value::from("format");
        let rp_format = val_map.get(&format_key).cloned();
        if rp_format.is_none() {
            val_map.insert(format_key, Value::from("yaml"));
        }

        // add path
        if let Some(path) = val_map.get(&path_key) {
            let path = path.as_str().unwrap();
            let absolute_path = dirs::app_home_dir().unwrap().join(path);
            absolute_path_map.insert(name.into(), absolute_path);
        } else {
            // no path value, set default path
            let format_val = rp_format.as_ref().map_or("yaml", |v| v.as_str().unwrap_or("yaml"));
            let path = format!("./rules/{name}.{format_val}");
            let absolute_path = dirs::app_home_dir().unwrap().join(path.trim_start_matches("./"));
            val_map.insert(path_key, path.into());
            absolute_path_map.insert(name.into(), absolute_path);
        }
    }
    profiles.set_rule_providers_path(absolute_path_map);
    config.insert(rp_key, rp_val.into());
    config
}

/// Enhance mode
/// 返回最终订阅、该订阅包含的键、和script执行的结果
pub fn enhance() -> (Mapping, HashMap<String, ResultLog>) {
    // config.yaml 的订阅
    let clash_config = Config::clash().latest().0.clone();

    // 从profiles里拿东西
    let (mut config, global_chain, profile_chain) = {
        let profiles = Config::profiles();
        let profiles = profiles.latest();
        let current = profiles.current_mapping().unwrap_or_default();
        let current_uid = profiles.get_current().cloned();

        // chain
        let global_chain = profiles.get_profile_chains(None, EnableFilter::Enable);
        let profile_chain = if current_uid.is_some() {
            profiles.get_profile_chains(current_uid, EnableFilter::Enable)
        } else {
            Vec::new()
        };
        (current, global_chain, profile_chain)
    };

    // 保存脚本日志
    let mut result_map = HashMap::new();

    // global chain
    tracing::info!("execute global chains");
    execute_chains(&mut config, &global_chain, &mut result_map);

    // profile chain
    tracing::info!("execute profile chains");
    execute_chains(&mut config, &profile_chain, &mut result_map);

    // 合并 verge 接管的 clash 配置
    tracing::info!("merge clash config file");
    for (key, value) in clash_config.into_iter() {
        config.insert(key, value);
    }

    let enable_external_controller = Config::verge().latest().enable_external_controller.unwrap_or_default();
    tracing::info!("external controller enable: {enable_external_controller}");
    if !enable_external_controller {
        config.remove("external-controller");
        config.remove("external-controller-cors");
        config.remove("secret");
    }
    config.remove("external-controller-unix");
    config.remove("external-controller-pipe");

    tracing::info!("setting tun");
    let enable_tun = Config::clash().latest().get_enable_tun();
    config = use_tun(config, enable_tun);
    tracing::info!("sort config key");
    config = use_sort(config);
    tracing::info!("generate rule providers");
    config = generate_rule_providers(config);

    (config, result_map)
}

pub fn get_pre_merge_result(profile_uid: Option<String>, modified_uid: String) -> AppResult<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let mut config = profiles.current_mapping().unwrap_or_default();

    // 保存脚本日志
    let mut script_logs = HashMap::new();

    match profile_uid {
        Some(profile_uid) => {
            // change current config mapping to profile mapping
            config = profiles.get_profile_mapping(&profile_uid).unwrap_or_default();

            // execute all enabled global chain
            tracing::info!("execute all global chains");
            let global_chain = profiles.get_profile_chains(None, EnableFilter::Enable);
            execute_chains(&mut config, &global_chain, &mut script_logs);

            // get new profile chain, index form 0 to modified chain index.
            tracing::info!("execute profile chains until find the modified chain");
            let profile_chain = {
                let chain = profiles.get_profile_chains(Some(profile_uid), EnableFilter::All);
                let new_chain = match chain.iter().position(|v| *v.uid == modified_uid) {
                    Some(index) => chain[..index].to_vec(),
                    None => chain,
                };
                new_chain.into_iter().filter(|c| c.enable).collect()
            };
            // execute new profile chain
            execute_chains(&mut config, &profile_chain, &mut script_logs);
        }
        None => {
            tracing::info!("execute global chains until find the modified chain");
            let global_chain = {
                let chain = profiles.get_profile_chains(None, EnableFilter::All);
                let new_chain = match chain.iter().position(|v| *v.uid == modified_uid) {
                    Some(index) => chain[..index].to_vec(),
                    None => chain,
                };
                new_chain.into_iter().filter(|c| c.enable).collect()
            };
            // global chain
            execute_chains(&mut config, &global_chain, &mut script_logs);
        }
    };
    // 排序
    config = use_sort(config);
    Ok(MergeResult {
        config,
        logs: script_logs,
    })
}

pub async fn test_merge_chain(
    profile_uid: Option<String>,
    modified_uid: String,
    content: String,
) -> AppResult<MergeResult> {
    let profiles = Config::profiles().latest().clone();
    let mut running_chains = profiles.chain.clone().unwrap_or_default();
    if let Some(profile_uid) = profile_uid.as_ref()
        && let Some(profile_item) = profiles.get_item(profile_uid)
        && let Some(profile_chains) = profile_item.chain.clone()
    {
        running_chains.extend(profile_chains);
    };
    let should_build_final_config =
        running_chains.is_empty() || running_chains[running_chains.len() - 1] == modified_uid;
    // 保存脚本日志
    let mut result_map = HashMap::new();

    let MergeResult { mut config, logs } = get_pre_merge_result(profile_uid, modified_uid.clone())?;
    result_map.extend(logs);

    let profile_item = profiles
        .get_item(&modified_uid)
        .ok_or(any_err!("failed to find the profile item \"uid:{modified_uid}\""))?;
    tracing::info!("test merge chain {:?}", profile_item.name);
    match profile_item.itype.as_ref() {
        Some(ProfileType::Merge) => {
            let yaml_content = serde_yaml::from_str::<Value>(&content)?
                .as_mapping()
                .ok_or(AppError::InvalidValue("invalid yaml content".to_string()))?
                .to_owned();
            config = use_merge(yaml_content, config.clone());
        }
        Some(ProfileType::Script) => {
            let mut logs = vec![];
            match use_script(content, config.clone()) {
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
            result_map.insert(modified_uid, logs);
        }
        Some(_) => {
            return Err(any_err!("unsupported chain type"));
        }
        None => {
            return Err(AppError::InvalidValue("missing chain type".to_string()));
        }
    };

    CoreManager::global()
        .check_config(ConfigType::MappingCheck(config.clone()))
        .await?;

    if should_build_final_config {
        //合并 verge 接管的配置
        let clash_config = Config::clash().latest().0.clone();
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

fn execute_chains(config: &mut Mapping, chains: &Vec<ChainItem>, script_logs: &mut HashMap<String, Vec<LogMessage>>) {
    for chain in chains {
        match chain.execute(config.clone()) {
            Ok(res) => {
                *config = res.config;
                if let Some(logs) = res.logs {
                    script_logs.extend(logs);
                }
            }
            Err(err) => {
                let log_message = LogMessage {
                    method: "error".into(),
                    data: vec![err.to_string()],
                    exception: Some(err.to_string()),
                };
                script_logs.insert(chain.uid.clone(), vec![log_message]);
                tracing::error!("execute chain {} [{}] failed, error: {}", chain.name, chain.uid, err);
            }
        }
    }
}

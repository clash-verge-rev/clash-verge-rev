use std::collections::{HashMap, VecDeque};

use anyhow::Context;
use mihomo_rule_parser::{RuleBehavior, RuleFormat, RulePayload};
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;

use crate::{
    config::{ClashInfo, Config},
    core::{CoreManager, handle, logger, service},
    enhance::{self, LogMessage, MergeResult},
    feat, wrap_err,
};

use super::CmdResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmdMergeResult {
    config: String,
    logs: HashMap<String, Vec<LogMessage>>,
}

#[tauri::command]
pub fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().latest().get_client_info())
}

#[tauri::command]
pub fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(Config::runtime().latest().config.clone())
}

#[tauri::command]
pub fn get_runtime_yaml() -> CmdResult<String> {
    let runtime = Config::runtime();
    let runtime = runtime.latest();
    let config = runtime.config.as_ref();
    wrap_err!(
        config
            .ok_or(anyhow::anyhow!(t!("config.parse.failed")))
            .and_then(|config| serde_yaml::to_string(config).context(t!("config.convert.failed")))
    )
}

#[tauri::command]
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<LogMessage>>> {
    Ok(Config::runtime().latest().chain_logs.clone())
}

#[tauri::command]
pub fn get_pre_merge_result(
    parent_uid: Option<String>,
    modified_uid: String,
) -> CmdResult<CmdMergeResult> {
    let MergeResult { config, logs } =
        wrap_err!(enhance::get_pre_merge_result(parent_uid, modified_uid))?;
    let config = wrap_err!(serde_yaml::to_string(&config))?;
    Ok(CmdMergeResult { config, logs })
}

#[tauri::command]
pub async fn test_merge_chain(
    profile_uid: Option<String>,
    modified_uid: String,
    content: String,
) -> CmdResult<CmdMergeResult> {
    let MergeResult { config, logs } =
        wrap_err!(enhance::test_merge_chain(profile_uid, modified_uid, content).await)?;
    let config = wrap_err!(serde_yaml::to_string(&config))?;
    Ok(CmdMergeResult { config, logs })
}

#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

#[tauri::command]
pub async fn change_clash_core(clash_core: Option<String>) -> CmdResult {
    wrap_err!(CoreManager::global().change_core(clash_core).await)
}

#[tauri::command]
pub async fn get_clash_logs() -> CmdResult<VecDeque<String>> {
    let enable_service_mode = {
        Config::verge()
            .latest()
            .enable_service_mode
            .unwrap_or_default()
    };
    let logs = if enable_service_mode {
        let res = wrap_err!(service::get_logs().await)?;
        res.data.unwrap_or_default()
    } else {
        logger::Logger::global().get_log()
    };
    Ok(logs)
}

#[tauri::command]
pub async fn get_rule_providers_payload() -> CmdResult<HashMap<String, RulePayload>> {
    let mut res = HashMap::new();
    let mihomo = handle::Handle::get_mihomo_read().await;
    let rule_providers = wrap_err!(mihomo.get_rule_providers().await)?;
    let profiles = Config::profiles();
    let rule_provider_paths = wrap_err!(profiles.latest().get_current_profile_rule_providers())?;
    for (name, rule_provider) in rule_providers.providers.iter() {
        if let Some(file_path) = rule_provider_paths.get(name) {
            let behavior = match rule_provider.behavior.as_str() {
                "Domain" => RuleBehavior::Domain,
                "IPCIDR" => RuleBehavior::IpCidr,
                "Classical" => RuleBehavior::Classical,
                _ => return Err("Unknown rule behavior".into()),
            };
            let format = match rule_provider.format.as_str() {
                "MrsRule" => RuleFormat::Mrs,
                "YamlRule" => RuleFormat::Yaml,
                "TextRule" => RuleFormat::Text,
                _ => return Err("Unknown rule format".into()),
            };
            let payload = wrap_err!(mihomo_rule_parser::parse(file_path, behavior, format))?;
            res.insert(name.clone(), payload);
        }
    }
    Ok(res)
}

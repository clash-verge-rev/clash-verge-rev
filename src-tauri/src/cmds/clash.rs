use std::collections::{HashMap, VecDeque};

use mihomo_rule_parser::{RuleBehavior, RuleFormat, RulePayload};
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;

use crate::{
    any_err,
    config::{ClashInfo, Config},
    core::{CoreManager, logger, service},
    enhance::{self, LogMessage, MergeResult},
    error::{AppError, AppResult},
    feat,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmdMergeResult {
    config: String,
    logs: HashMap<String, Vec<LogMessage>>,
}

#[tauri::command]
pub fn get_clash_info() -> AppResult<ClashInfo> {
    Ok(Config::clash().latest().get_client_info())
}

#[tauri::command]
pub fn get_runtime_config() -> AppResult<Option<Mapping>> {
    Ok(Config::runtime().latest().config.clone())
}

#[tauri::command]
pub fn get_runtime_yaml() -> AppResult<String> {
    let runtime = Config::runtime();
    let runtime = runtime.latest();
    let config = runtime.config.as_ref();
    config
        .ok_or(any_err!("{}", t!("config.parse.failed")))
        .and_then(|config| serde_yaml::to_string(config).map_err(AppError::SerdeYaml))
}

#[tauri::command]
pub fn get_runtime_logs() -> AppResult<HashMap<String, Vec<LogMessage>>> {
    Ok(Config::runtime().latest().chain_logs.clone())
}

#[tauri::command]
pub fn get_pre_merge_result(parent_uid: Option<String>, modified_uid: String) -> AppResult<CmdMergeResult> {
    let MergeResult { config, logs } = enhance::get_pre_merge_result(parent_uid, modified_uid)?;
    let config = serde_yaml::to_string(&config)?;
    Ok(CmdMergeResult { config, logs })
}

#[tauri::command]
pub async fn test_merge_chain(
    profile_uid: Option<String>,
    modified_uid: String,
    content: String,
) -> AppResult<CmdMergeResult> {
    let MergeResult { config, logs } = enhance::test_merge_chain(profile_uid, modified_uid, content).await?;
    let config = serde_yaml::to_string(&config)?;
    Ok(CmdMergeResult { config, logs })
}

#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> AppResult<()> {
    feat::patch_clash(payload).await
}

#[tauri::command]
pub async fn change_clash_core(clash_core: Option<String>) -> AppResult<()> {
    CoreManager::global().change_core(clash_core).await
}

#[tauri::command]
pub async fn get_clash_logs() -> AppResult<VecDeque<String>> {
    let enable_service_mode = Config::verge().latest().enable_service_mode.unwrap_or_default();
    let logs = if enable_service_mode {
        let res = service::get_logs().await?;
        res.data.unwrap_or_default()
    } else {
        logger::Logger::global().get_logs().clone()
    };
    Ok(logs)
}

#[tauri::command]
pub async fn get_rule_provider_payload(
    provider_name: String,
    behavior: RuleBehavior,
    format: RuleFormat,
) -> AppResult<RulePayload> {
    let file_path = Config::profiles()
        .latest()
        .get_current_rule_providers_path()
        .and_then(|m| m.get(&provider_name))
        .ok_or(any_err!("Provider not found"))?
        .clone();
    let payload = mihomo_rule_parser::parse(file_path, behavior, format)?;
    Ok(payload)
}

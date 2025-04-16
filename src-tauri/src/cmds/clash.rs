use std::collections::{HashMap, VecDeque};

use anyhow::Context;
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;

use crate::{
    config::{ClashInfo, Config},
    core::{logger, CoreManager},
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
    wrap_err!(config
        .ok_or(anyhow::anyhow!(t!("config.parse.failed")))
        .and_then(|config| serde_yaml::to_string(config).context(t!("config.convert.failed"))))
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
pub fn get_clash_logs() -> CmdResult<VecDeque<String>> {
    Ok(logger::Logger::global().get_log())
}

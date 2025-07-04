use super::CmdResult;
use crate::{config::*, wrap_err};
use anyhow::Context;
use serde_yaml::Mapping;
use std::collections::HashMap;

/// 获取运行时配置
#[tauri::command]
pub fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(Config::runtime().latest_ref().config.clone())
}

/// 获取运行时YAML配置
#[tauri::command]
pub fn get_runtime_yaml() -> CmdResult<String> {
    let runtime = Config::runtime();
    let runtime = runtime.latest_ref();
    let config = runtime.config.as_ref();
    wrap_err!(config
        .ok_or(anyhow::anyhow!("failed to parse config to yaml file"))
        .and_then(
            |config| serde_yaml::to_string(config).context("failed to convert config to yaml")
        ))
}

/// 获取运行时存在的键
#[tauri::command]
pub fn get_runtime_exists() -> CmdResult<Vec<String>> {
    Ok(Config::runtime().latest_ref().exists_keys.clone())
}

/// 获取运行时日志
#[tauri::command]
pub fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
    Ok(Config::runtime().latest_ref().chain_logs.clone())
}

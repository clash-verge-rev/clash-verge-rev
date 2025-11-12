use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::{Config, ConfigType},
    core::CoreManager,
    log_err,
};
use anyhow::{Context as _, anyhow};
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::collections::HashMap;

/// 获取运行时配置
#[tauri::command]
pub async fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(Config::runtime().await.latest_arc().config.clone())
}

/// 获取运行时YAML配置
#[tauri::command]
pub async fn get_runtime_yaml() -> CmdResult<String> {
    let runtime = Config::runtime().await;
    let runtime = runtime.latest_arc();

    let config = runtime.config.as_ref();
    config
        .ok_or_else(|| anyhow!("failed to parse config to yaml file"))
        .and_then(|config| {
            serde_yaml_ng::to_string(config)
                .context("failed to convert config to yaml")
                .map(|s| s.into())
        })
        .stringify_err()
}

/// 获取运行时存在的键
#[tauri::command]
pub async fn get_runtime_exists() -> CmdResult<Vec<String>> {
    Ok(Config::runtime().await.latest_arc().exists_keys.clone())
}

/// 获取运行时日志
#[tauri::command]
pub async fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
    Ok(Config::runtime().await.latest_arc().chain_logs.clone())
}

#[tauri::command]
pub async fn get_runtime_proxy_chain_config(proxy_chain_exit_node: String) -> CmdResult<String> {
    let runtime = Config::runtime().await;
    let runtime = runtime.latest_arc();

    let config = runtime
        .config
        .as_ref()
        .ok_or_else(|| anyhow!("failed to parse config to yaml file"))
        .stringify_err()?;

    if let Some(serde_yaml_ng::Value::Sequence(proxies)) = config.get("proxies") {
        let mut proxy_name = Some(Some(proxy_chain_exit_node.as_str()));
        let mut proxies_chain = Vec::new();

        while let Some(proxy) = proxies.iter().find(|proxy| {
            if let serde_yaml_ng::Value::Mapping(proxy_map) = proxy {
                proxy_map.get("name").map(|x| x.as_str()) == proxy_name
                    && proxy_map.get("dialer-proxy").is_some()
            } else {
                false
            }
        }) {
            proxies_chain.push(proxy.to_owned());
            proxy_name = proxy.get("dialer-proxy").map(|x| x.as_str());
        }

        if let Some(entry_proxy) = proxies
            .iter()
            .find(|proxy| proxy.get("name").map(|x| x.as_str()) == proxy_name)
            && !proxies_chain.is_empty()
        {
            // 添加第一个节点
            proxies_chain.push(entry_proxy.to_owned());
        }

        proxies_chain.reverse();

        let mut config: HashMap<String, Vec<serde_yaml_ng::Value>> = HashMap::new();

        config.insert("proxies".into(), proxies_chain);

        serde_yaml_ng::to_string(&config)
            .context("YAML generation failed")
            .map(|s| s.into())
            .stringify_err()
    } else {
        Err("failed to get proxies or proxy-groups".into())
    }
}

/// 更新运行时链式代理配置
#[tauri::command]
pub async fn update_proxy_chain_config_in_runtime(
    proxy_chain_config: Option<serde_yaml_ng::Value>,
) -> CmdResult<()> {
    {
        let runtime = Config::runtime().await;
        runtime.edit_draft(|d| d.update_proxy_chain_config(proxy_chain_config));
        runtime.apply();
    }

    // 生成新的运行配置文件并通知 Clash 核心重新加载
    let run_path = Config::generate_file(ConfigType::Run)
        .await
        .stringify_err()?;
    log_err!(CoreManager::global().put_configs_force(run_path).await);

    Ok(())
}

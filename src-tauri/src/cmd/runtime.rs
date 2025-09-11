use super::CmdResult;
use crate::{config::*, core::CoreManager, wrap_err};
use anyhow::Context;
use regex::Regex;
use serde_yaml_ng::Mapping;
use std::collections::HashMap;

/// 获取运行时配置
#[tauri::command]
pub async fn get_runtime_config() -> CmdResult<Option<Mapping>> {
    Ok(Config::runtime().await.latest_ref().config.clone())
}

/// 获取运行时YAML配置
#[tauri::command]
pub async fn get_runtime_yaml() -> CmdResult<String> {
    let runtime = Config::runtime().await;
    let runtime = runtime.latest_ref();

    let config = runtime.config.as_ref();

    wrap_err!(config
        .ok_or(anyhow::anyhow!("failed to parse config to yaml file"))
        .and_then(
            |config| serde_yaml_ng::to_string(config).context("failed to convert config to yaml")
        ))
}

/// 获取运行时存在的键
#[tauri::command]
pub async fn get_runtime_exists() -> CmdResult<Vec<String>> {
    Ok(Config::runtime().await.latest_ref().exists_keys.clone())
}

/// 获取运行时日志
#[tauri::command]
pub async fn get_runtime_logs() -> CmdResult<HashMap<String, Vec<(String, String)>>> {
    Ok(Config::runtime().await.latest_ref().chain_logs.clone())
}

/// 读取运行时链式代理配置
#[tauri::command]
pub async fn get_runtime_proxy_chain_config() -> CmdResult<String> {
    let runtime = Config::runtime().await;
    let runtime = runtime.latest_ref();

    let config = wrap_err!(runtime
        .config
        .as_ref()
        .ok_or(anyhow::anyhow!("failed to parse config to yaml file")))?;
    let re = wrap_err!(Regex::new(r"^chain_node_\d+_"))?;

    if let (
        Some(serde_yaml_ng::Value::Sequence(proxies)),
        Some(serde_yaml_ng::Value::Sequence(proxy_groups)),
    ) = (config.get("proxies"), config.get("proxy-groups"))
    {
        let proxy_chain_groups = proxy_groups
            .iter()
            .filter_map(
                |proxy_group| match proxy_group.get("name").and_then(|n| n.as_str()) {
                    Some(name) if name.starts_with("chain_") => Some(proxy_group.to_owned()),
                    _ => None,
                },
            )
            .collect::<Vec<serde_yaml_ng::Value>>();

        let last_proxy_name = {
            if let Some(proxy_chain_group) = proxy_chain_groups.last() {
                if let Some(serde_yaml_ng::Value::Sequence(nodes)) =
                    proxy_chain_group.get("proxies")
                {
                    if let Some(name) = nodes[0].to_owned().as_str() {
                        let mut name = name.to_string();
                        name = re.replace_all(&name, "").to_string();
                        Some(name)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };

        let mut proxy_chain_nodes = proxies
            .iter()
            .filter_map(|proxy| {
                if proxy.get("dialer-proxy").is_some() {
                    Some(proxy.to_owned())
                } else {
                    None
                }
            })
            .collect::<Vec<serde_yaml_ng::Value>>();

        if let Some(last_proxy) = proxies.iter().find(|proxy| {
            proxy
                .get("name")
                .is_some_and(|name| name.as_str() == last_proxy_name.as_deref())
        }) {
            proxy_chain_nodes.push(last_proxy.to_owned());
        }

        proxy_chain_nodes.iter_mut().for_each(|proxy_chain_node| {
            if let Some(serde_yaml_ng::Value::String(ref mut name)) =
                proxy_chain_node.get_mut("name")
            {
                *name = re.replace_all(name, "").to_string();
                *name = name.replace("entry_node_", "");
            }
        });

        let mut config: HashMap<String, Vec<serde_yaml_ng::Value>> = HashMap::new();
        config.insert("proxies".to_string(), proxy_chain_nodes);
        config.insert("proxy-groups".to_string(), proxy_chain_groups);

        wrap_err!(serde_yaml_ng::to_string(&config).context("YAML generation failed"))
    } else {
        wrap_err!(Err(anyhow::anyhow!(
            "failed to get proxies or proxy-groups".to_string()
        )))
    }
}

/// 跟新运行时链式代理配置
#[tauri::command]
pub async fn update_proxy_chain_config_in_runtime(
    proxy_chain_config: Option<serde_yaml_ng::Value>,
) -> CmdResult<()> {
    {
        let runtime = Config::runtime().await;
        let mut draft = runtime.draft_mut();
        draft.update_proxy_chain_config(proxy_chain_config);
        drop(draft);
        runtime.apply();
    }

    // 生成新的运行配置文件并通知 Clash 核心重新加载
    let run_path = wrap_err!(Config::generate_file(ConfigType::Run).await)?;
    wrap_err!(CoreManager::global().put_configs_force(run_path).await);

    Ok(())
}

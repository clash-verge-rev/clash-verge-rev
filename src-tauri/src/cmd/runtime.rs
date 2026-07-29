use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::Config,
    core::CoreManager,
    utils::{dirs, help, yaml_emitter},
};
use anyhow::{Context as _, anyhow, bail};
use clash_verge_logging::{Type, logging};
use serde::Deserialize;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyChainNodeRef {
    name: String,
    record_id: Option<String>,
    source: Option<ProxyChainNodeSource>,
    profile_uid: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ProxyChainNodeSource {
    Core {
        #[serde(rename = "proxyName")]
        proxy_name: String,
    },
    Provider {
        #[serde(rename = "providerName")]
        provider_name: String,
        #[serde(rename = "proxyName")]
        proxy_name: String,
    },
}

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
            yaml_emitter::to_mihomo_config_string(config)
                .context("failed to convert config to yaml")
                .map(|s| s.into())
        })
        .stringify_err()
}

/// 获取运行时存在的键
#[tauri::command]
pub async fn get_runtime_exists() -> CmdResult<HashSet<String>> {
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
                proxy_map.get("name").map(|x| x.as_str()) == proxy_name && proxy_map.get("dialer-proxy").is_some()
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

        yaml_emitter::to_mihomo_config_string(&config)
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
    proxy_chain_config: Option<Vec<ProxyChainNodeRef>>,
    target_group: Option<String>,
) -> CmdResult<()> {
    if proxy_chain_config.is_some()
        && let Some(group_name) = target_group.as_deref().filter(|group| *group != "GLOBAL")
    {
        let runtime = Config::runtime().await;
        let runtime = runtime.latest_arc();
        let group_exists = runtime
            .config
            .as_ref()
            .and_then(|config| config.get("proxy-groups"))
            .and_then(serde_yaml_ng::Value::as_sequence)
            .is_some_and(|groups| {
                groups
                    .iter()
                    .any(|group| group.get("name").and_then(serde_yaml_ng::Value::as_str) == Some(group_name))
            });
        if !group_exists {
            return Err(format!("proxy group \"{group_name}\" is not in the current runtime config").into());
        }
    }

    let chain_config = match proxy_chain_config {
        Some(chain) => Some(resolve_proxy_chain_config(chain).await.stringify_err()?),
        None => None,
    };

    match CoreManager::global()
        .update_runtime_config(|d| d.update_proxy_chain_config(chain_config, target_group))
        .await
    {
        Ok(outcome) if outcome.is_valid() => {}
        Ok(outcome) => {
            logging!(
                warn,
                Type::Core,
                "Failed to apply runtime proxy chain config: {}",
                outcome
            );
            return Err(format!("Failed to apply runtime proxy chain config: {outcome}").into());
        }
        Err(err) => {
            logging!(error, Type::Core, "Failed to apply runtime proxy chain config: {}", err);
            return Err(format!("Failed to apply runtime proxy chain config: {err}").into());
        }
    }

    Ok(())
}

async fn resolve_proxy_chain_config(chain: Vec<ProxyChainNodeRef>) -> anyhow::Result<Vec<serde_yaml_ng::Value>> {
    if chain.len() < 2 {
        bail!("proxy chain requires at least two nodes");
    }

    let mut seen = HashSet::new();
    for node in &chain {
        if !seen.insert(node.name.clone()) {
            bail!("duplicate proxy chain node \"{}\"", node.name);
        }
    }

    let runtime = Config::runtime().await;
    let runtime = runtime.latest_arc();
    let runtime_config = runtime
        .config
        .as_ref()
        .ok_or_else(|| anyhow!("failed to parse config to yaml file"))?;

    let mut profile_cache = HashMap::<String, Mapping>::new();
    let mut resolved = Vec::with_capacity(chain.len());

    for node in chain {
        if let Some(proxy) = find_proxy_in_config(runtime_config, &node.name) {
            resolved.push(sanitize_proxy_for_chain(proxy));
            continue;
        }

        if let Some(ProxyChainNodeSource::Provider {
            provider_name,
            proxy_name,
        }) = node.source.as_ref()
        {
            let proxy = find_proxy_in_runtime_provider(runtime_config, provider_name, proxy_name)
                .await
                .with_context(|| format!("failed to resolve proxy provider \"{provider_name}\""))?
                .with_context(|| {
                    format!(
                        "proxy chain node \"{}\" was not found in provider \"{}\"",
                        node.name, provider_name
                    )
                })?;
            resolved.push(sanitize_proxy_for_chain(proxy));
            continue;
        }

        let Some(profile_uid) = node.profile_uid.as_ref() else {
            let source = match node.source.as_ref() {
                Some(ProxyChainNodeSource::Core { proxy_name }) => format!("core:{proxy_name}"),
                Some(ProxyChainNodeSource::Provider {
                    provider_name,
                    proxy_name,
                }) => format!("provider:{provider_name}:{proxy_name}"),
                None => "unknown source".to_string(),
            };
            bail!(
                "proxy chain node \"{}\" ({}, recordId: {}) is not in the current runtime config and has no profile uid",
                node.name,
                source,
                node.record_id.as_deref().unwrap_or("unknown")
            );
        };

        if !profile_cache.contains_key(profile_uid) {
            let config = load_profile_mapping(profile_uid).await?;
            profile_cache.insert(profile_uid.clone(), config);
        }
        let profile_config = profile_cache
            .get(profile_uid)
            .ok_or_else(|| anyhow!("profile cache entry \"{profile_uid}\" is unavailable"))?;

        let proxy = find_proxy_in_config(profile_config, &node.name).with_context(|| {
            format!(
                "proxy chain node \"{}\" was not found in profile \"{}\"",
                node.name, profile_uid
            )
        })?;
        resolved.push(sanitize_proxy_for_chain(proxy));
    }

    Ok(resolved)
}

async fn find_proxy_in_runtime_provider(
    runtime_config: &Mapping,
    provider_name: &str,
    proxy_name: &str,
) -> anyhow::Result<Option<serde_yaml_ng::Value>> {
    let provider = runtime_config
        .get("proxy-providers")
        .and_then(serde_yaml_ng::Value::as_mapping)
        .and_then(|providers| providers.get(provider_name))
        .and_then(serde_yaml_ng::Value::as_mapping)
        .with_context(|| format!("proxy provider \"{provider_name}\" is not in the current runtime config"))?;

    let raw_path = provider
        .get("path")
        .and_then(serde_yaml_ng::Value::as_str)
        .with_context(|| format!("proxy provider \"{provider_name}\" has no path"))?;
    let provider_path = runtime_provider_path(raw_path)?;
    let value = help::read_yaml::<serde_yaml_ng::Value>(&provider_path)
        .await
        .with_context(|| format!("failed to read proxy provider \"{provider_name}\""))?;
    let provider_config = value
        .as_mapping()
        .with_context(|| format!("proxy provider \"{provider_name}\" is not a YAML mapping"))?;

    Ok(find_proxy_in_config(provider_config, proxy_name))
}

fn runtime_provider_path(raw_path: &str) -> anyhow::Result<PathBuf> {
    let path = Path::new(raw_path);
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        dirs::app_home_dir()?.join(path)
    })
}

async fn load_profile_mapping(profile_uid: &str) -> anyhow::Result<Mapping> {
    let item = {
        let profiles = Config::profiles().await;
        let profiles = profiles.latest_arc();
        profiles
            .get_item(profile_uid)
            .with_context(|| format!("failed to find profile \"{profile_uid}\""))?
            .clone()
    };

    let file = item
        .file
        .as_ref()
        .ok_or_else(|| anyhow!("profile \"{profile_uid}\" has no file"))?;
    let path = dirs::app_profiles_dir()?.join(file.as_str());
    let value = help::read_yaml::<serde_yaml_ng::Value>(&path)
        .await
        .with_context(|| format!("failed to read profile \"{profile_uid}\""))?;

    value
        .as_mapping()
        .cloned()
        .ok_or_else(|| anyhow!("profile \"{profile_uid}\" is not a YAML mapping"))
}

fn find_proxy_in_config(config: &Mapping, name: &str) -> Option<serde_yaml_ng::Value> {
    config
        .get("proxies")
        .and_then(serde_yaml_ng::Value::as_sequence)?
        .iter()
        .find(|proxy| proxy.get("name").and_then(serde_yaml_ng::Value::as_str) == Some(name))
        .cloned()
}

fn sanitize_proxy_for_chain(mut proxy: serde_yaml_ng::Value) -> serde_yaml_ng::Value {
    if let Some(mapping) = proxy.as_mapping_mut() {
        mapping.remove("dialer-proxy");
    }
    proxy
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{find_proxy_in_config, sanitize_proxy_for_chain};
    use serde_yaml_ng::Value;

    #[test]
    fn find_proxy_in_config_returns_named_proxy() {
        let config: serde_yaml_ng::Mapping = serde_yaml_ng::from_str(
            r"
proxies:
  - name: A
    type: direct
  - name: B
    type: reject
",
        )
        .unwrap();

        let proxy = find_proxy_in_config(&config, "B").unwrap();
        assert_eq!(proxy.get("name").and_then(Value::as_str), Some("B"));
    }

    #[test]
    fn sanitize_proxy_for_chain_removes_existing_dialer_proxy() {
        let proxy: Value = serde_yaml_ng::from_str(
            r"
name: A
type: ss
dialer-proxy: OLD
",
        )
        .unwrap();

        let proxy = sanitize_proxy_for_chain(proxy);
        assert!(proxy.get("dialer-proxy").is_none());
    }
}

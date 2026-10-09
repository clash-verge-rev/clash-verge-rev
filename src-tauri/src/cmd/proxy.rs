use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    config::Config,
    core::{
        handle::Handle,
        proxy_view::{GroupScope, ProxyViewBuilder, ProxyViewInput, ProxyViewV1},
        tray::Tray,
    },
    process::AsyncHandler,
};
use clash_verge_logging::{Type, logging};
use serde_yaml_ng::Mapping;
use std::{
    collections::{BTreeMap, HashSet},
    sync::atomic::{AtomicBool, Ordering},
};

/// Merges one selection pair into fresh backend state to avoid stale-list overwrites.
#[tauri::command]
pub async fn record_selected_node(group_name: String, node: String) -> CmdResult<()> {
    crate::config::profiles::record_selected_node(&group_name, &node)
        .await
        .stringify_err()
}

#[tauri::command]
pub async fn forget_selected_node(group_name: String) -> CmdResult<()> {
    crate::config::profiles::forget_selected_node(&group_name)
        .await
        .stringify_err()
}

static TRAY_SYNC_RUNNING: AtomicBool = AtomicBool::new(false);
static TRAY_SYNC_PENDING: AtomicBool = AtomicBool::new(false);

fn runtime_group_order(config: Option<&Mapping>) -> Vec<String> {
    let mut seen = HashSet::new();

    config
        .and_then(|config| config.get("proxy-groups"))
        .and_then(|groups| groups.as_sequence())
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("name"))
        .filter_map(|name| name.as_str())
        .filter(|name| !name.is_empty() && *name != "GLOBAL")
        .filter(|name| seen.insert(*name))
        .map(str::to_owned)
        .collect()
}

/// Mirrors Mihomo: `include-all`/`include-all-providers` replace `use` with every provider, sorted.
fn runtime_group_scopes(config: Option<&Mapping>) -> BTreeMap<String, GroupScope> {
    let Some(config) = config else {
        return BTreeMap::new();
    };
    let mut all_providers = config
        .get("proxy-providers")
        .and_then(|providers| providers.as_mapping())
        .into_iter()
        .flat_map(|providers| providers.keys())
        .filter_map(|name| name.as_str())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    all_providers.sort();
    let flag = |group: &Mapping, key: &str| group.get(key).and_then(|value| value.as_bool()) == Some(true);

    config
        .get("proxy-groups")
        .and_then(|groups| groups.as_sequence())
        .into_iter()
        .flatten()
        .filter_map(|group| group.as_mapping())
        .filter_map(|group| {
            let name = group.get("name")?.as_str()?.to_owned();
            let providers = if flag(group, "include-all") || flag(group, "include-all-providers") {
                all_providers.clone()
            } else {
                group
                    .get("use")
                    .and_then(|providers| providers.as_sequence())
                    .into_iter()
                    .flatten()
                    .filter_map(|provider| provider.as_str())
                    .map(str::to_owned)
                    .collect()
            };
            let exclude_types = group
                .get("exclude-type")
                .and_then(|types| types.as_str())
                .filter(|types| !types.is_empty())
                .map(|types| types.split('|').map(str::to_owned).collect())
                .unwrap_or_default();
            Some((
                name,
                GroupScope {
                    providers,
                    exclude_types,
                },
            ))
        })
        .collect()
}

#[tauri::command]
pub async fn get_proxy_view() -> CmdResult<ProxyViewV1> {
    proxy_view(None).await
}

pub(crate) async fn proxy_view(provider_timeout: Option<std::time::Duration>) -> CmdResult<ProxyViewV1> {
    let runtime = Config::runtime().await;
    let latest_runtime = runtime.latest_arc();
    let runtime_group_order = runtime_group_order(latest_runtime.config.as_ref());
    let group_scopes = runtime_group_scopes(latest_runtime.config.as_ref());

    let mihomo = Handle::mihomo();
    let (proxies, providers) = tokio::join!(mihomo.get_proxies(), async {
        match provider_timeout {
            Some(timeout) => tokio::time::timeout(timeout, mihomo.get_proxy_providers())
                .await
                .ok()
                .and_then(Result::ok),
            None => mihomo.get_proxy_providers().await.ok(),
        }
    });
    let proxies = proxies.stringify_err()?;

    Ok(ProxyViewBuilder::build(ProxyViewInput {
        runtime_group_order,
        group_scopes,
        proxies,
        providers,
    }))
}

#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    if TRAY_SYNC_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        AsyncHandler::spawn(move || async move {
            run_tray_sync_loop().await;
        });
    } else {
        TRAY_SYNC_PENDING.store(true, Ordering::Release);
    }

    Ok(())
}

async fn run_tray_sync_loop() {
    // Permanent watcher: keeps syncing until a pass finds no pending sync request.
    loop {
        match Tray::global().update_menu().await {
            Ok(_) => {
                logging!(debug, Type::Cmd, "Tray proxy selection synced successfully");
            }
            Err(e) => {
                logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e:#}");
            }
        }

        if !TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel) {
            TRAY_SYNC_RUNNING.store(false, Ordering::Release);

            if TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel)
                && TRAY_SYNC_RUNNING
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                continue;
            }

            break;
        }
    }
}

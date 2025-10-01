use std::collections::HashMap;

use tauri::{State, async_runtime::RwLock, command, ipc::Channel};

use crate::{Result, mihomo::Mihomo, models::*};

#[command]
pub(crate) async fn update_controller(
    state: State<'_, RwLock<Mihomo>>,
    host: Option<String>,
    port: Option<u32>,
) -> Result<()> {
    let mut mihomo = state.write().await;
    mihomo.update_external_host(host);
    mihomo.update_external_port(port);
    Ok(())
}

#[command]
pub(crate) async fn update_secret(state: State<'_, RwLock<Mihomo>>, secret: Option<String>) -> Result<()> {
    state.write().await.update_secret(secret);
    Ok(())
}

#[command]
pub(crate) async fn get_version(state: State<'_, RwLock<Mihomo>>) -> Result<MihomoVersion> {
    state.read().await.get_version().await
}

#[command]
pub(crate) async fn flush_fakeip(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.flush_fakeip().await
}

#[command]
pub(crate) async fn flush_dns(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.flush_dns().await
}

// connections
#[command]
pub(crate) async fn get_connections(state: State<'_, RwLock<Mihomo>>) -> Result<Connections> {
    state.read().await.get_connections().await
}

#[command]
pub(crate) async fn close_all_connections(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.close_all_connections().await
}

#[command]
pub(crate) async fn close_connections(state: State<'_, RwLock<Mihomo>>, connection_id: String) -> Result<()> {
    state.read().await.close_connection(&connection_id).await
}

// groups
#[command]
pub(crate) async fn get_groups(state: State<'_, RwLock<Mihomo>>) -> Result<Groups> {
    state.read().await.get_groups().await
}

#[command]
pub(crate) async fn get_group_by_name(state: State<'_, RwLock<Mihomo>>, group_name: String) -> Result<Proxy> {
    state.read().await.get_group_by_name(&group_name).await
}

#[command]
pub(crate) async fn delay_group(
    state: State<'_, RwLock<Mihomo>>,
    group_name: String,
    test_url: String,
    timeout: u32,
    keep_fixed: bool,
) -> Result<HashMap<String, u32>> {
    let fixed = if keep_fixed {
        state.read().await.get_group_by_name(&group_name).await?.fixed
    } else {
        None
    };
    log::debug!("delay group, fixed: {fixed:?}");
    let res = state.read().await.delay_group(&group_name, &test_url, timeout).await?;
    if keep_fixed
        && let Some(fixed) = fixed
        && !fixed.is_empty()
    {
        state.read().await.select_node_for_group(&group_name, &fixed).await?;
    }
    Ok(res)
}

// providers
#[command]
pub(crate) async fn get_proxy_providers(state: State<'_, RwLock<Mihomo>>) -> Result<ProxyProviders> {
    state.read().await.get_proxy_providers().await
}

#[command]
pub(crate) async fn get_proxy_provider_by_name(
    state: State<'_, RwLock<Mihomo>>,
    provider_name: String,
) -> Result<ProxyProvider> {
    state.read().await.get_proxy_provider_by_name(&provider_name).await
}

#[command]
pub(crate) async fn update_proxy_provider(state: State<'_, RwLock<Mihomo>>, provider_name: String) -> Result<()> {
    state.read().await.update_proxy_provider(&provider_name).await
}

#[command]
pub(crate) async fn healthcheck_proxy_provider(state: State<'_, RwLock<Mihomo>>, provider_name: String) -> Result<()> {
    state.read().await.healthcheck_proxy_provider(&provider_name).await
}

#[command]
pub(crate) async fn healthcheck_node_in_provider(
    state: State<'_, RwLock<Mihomo>>,
    provider_name: String,
    proxy_name: String,
    test_url: String,
    timeout: u32,
) -> Result<ProxyDelay> {
    state
        .read()
        .await
        .healthcheck_node_in_provider(&provider_name, &proxy_name, &test_url, timeout)
        .await
}

// proxies
#[command]
pub(crate) async fn get_proxies(state: State<'_, RwLock<Mihomo>>) -> Result<Proxies> {
    state.read().await.get_proxies().await
}

#[command]
pub(crate) async fn get_proxy_by_name(state: State<'_, RwLock<Mihomo>>, proxy_name: String) -> Result<Proxy> {
    state.read().await.get_proxy_by_name(&proxy_name).await
}

#[command]
pub(crate) async fn select_node_for_group(
    state: State<'_, RwLock<Mihomo>>,
    group_name: String,
    node: String,
) -> Result<()> {
    state.read().await.select_node_for_group(&group_name, &node).await
}

#[command]
pub(crate) async fn unfixed_proxy(state: State<'_, RwLock<Mihomo>>, group_name: String) -> Result<()> {
    state.read().await.unfixed_proxy(&group_name).await
}

#[command]
pub(crate) async fn delay_proxy_by_name(
    state: State<'_, RwLock<Mihomo>>,
    proxy_name: String,
    test_url: String,
    timeout: u32,
) -> Result<ProxyDelay> {
    state
        .read()
        .await
        .delay_proxy_by_name(&proxy_name, &test_url, timeout)
        .await
}

// rules
#[command]
pub(crate) async fn get_rules(state: State<'_, RwLock<Mihomo>>) -> Result<Rules> {
    state.read().await.get_rules().await
}

#[command]
pub(crate) async fn get_rule_providers(state: State<'_, RwLock<Mihomo>>) -> Result<RuleProviders> {
    state.read().await.get_rule_providers().await
}

#[command]
pub(crate) async fn update_rule_provider(state: State<'_, RwLock<Mihomo>>, provider_name: String) -> Result<()> {
    state.read().await.update_rule_provider(&provider_name).await
}

// runtime config
#[command]
pub(crate) async fn get_base_config(state: State<'_, RwLock<Mihomo>>) -> Result<BaseConfig> {
    state.read().await.get_base_config().await
}

#[command]
pub(crate) async fn reload_config(state: State<'_, RwLock<Mihomo>>, force: bool, config_path: String) -> Result<()> {
    state.read().await.reload_config(force, &config_path).await
}

#[command]
pub(crate) async fn patch_base_config(state: State<'_, RwLock<Mihomo>>, data: serde_json::Value) -> Result<()> {
    state.read().await.patch_base_config(&data).await
}

#[command]
pub(crate) async fn update_geo(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.update_geo().await
}

#[command]
pub(crate) async fn restart(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.restart().await
}

// upgrade
#[command]
pub(crate) async fn upgrade_core(
    state: State<'_, RwLock<Mihomo>>,
    channel: CoreUpdaterChannel,
    force: bool,
) -> Result<()> {
    state.read().await.upgrade_core(channel, force).await
}

#[command]
pub(crate) async fn upgrade_ui(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.upgrade_ui().await
}

#[command]
pub(crate) async fn upgrade_geo(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.read().await.upgrade_geo().await
}

// mihomo websocket
#[command]
pub(crate) async fn ws_traffic(
    state: State<'_, RwLock<Mihomo>>,
    on_message: Channel<serde_json::Value>,
) -> Result<ConnectionId> {
    state
        .read()
        .await
        .ws_traffic(move |data| {
            let _ = on_message.send(data);
        })
        .await
}

#[command]
pub(crate) async fn ws_memory(
    state: State<'_, RwLock<Mihomo>>,
    on_message: Channel<serde_json::Value>,
) -> Result<ConnectionId> {
    state
        .read()
        .await
        .ws_memory(move |data| {
            let _ = on_message.send(data);
        })
        .await
}

#[command]
pub(crate) async fn ws_connections(
    state: State<'_, RwLock<Mihomo>>,
    on_message: Channel<serde_json::Value>,
) -> Result<ConnectionId> {
    state
        .read()
        .await
        .ws_connections(move |data| {
            let _ = on_message.send(data);
        })
        .await
}

#[command]
pub(crate) async fn ws_logs(
    state: State<'_, RwLock<Mihomo>>,
    level: LogLevel,
    on_message: Channel<serde_json::Value>,
) -> Result<ConnectionId> {
    state
        .read()
        .await
        .ws_logs(level, move |data| {
            let _ = on_message.send(data);
        })
        .await
}

// mihomo 的 websocket 应该只读取数据，没必要发送数据
// #[command]
// pub(crate) async fn ws_send(
//     state: State<'_, RwLock<Mihomo>>,
//     id: u32,
//     message: WebSocketMessage,
// ) -> Result<()> {
//     state.read().await.send(id, message).await
// }

#[command]
pub(crate) async fn ws_disconnect(
    state: State<'_, RwLock<Mihomo>>,
    id: ConnectionId,
    force_timeout: Option<u64>,
) -> Result<()> {
    state.read().await.disconnect(id, force_timeout).await
}

#[command]
pub(crate) async fn clear_all_ws_connections(state: State<'_, RwLock<Mihomo>>) -> Result<()> {
    state.write().await.clear_all_ws_connections().await
}

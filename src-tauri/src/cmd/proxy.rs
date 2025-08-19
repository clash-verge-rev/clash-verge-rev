use super::CmdResult;
use crate::{ipc::IpcManager, logging, state::proxy::ProxyRequestCache, utils::logging::Type};
use std::time::Duration;

const PROXIES_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const PROVIDERS_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let manager = IpcManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    let value = cache
        .get_or_fetch(key, PROXIES_REFRESH_INTERVAL, || async {
            manager.get_proxies().await.unwrap_or_else(|e| {
                logging!(error, Type::Cmd, "Failed to fetch proxies: {e}");
                serde_json::Value::Object(serde_json::Map::new())
            })
        })
        .await;
    Ok((*value).clone())
}

/// 强制刷新代理缓存用于profile切换
#[tauri::command]
pub async fn force_refresh_proxies() -> CmdResult<serde_json::Value> {
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    cache.map.remove(&key);
    get_proxies().await
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let manager = IpcManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("providers", "default");
    let value = cache
        .get_or_fetch(key, PROVIDERS_REFRESH_INTERVAL, || async {
            manager.get_providers_proxies().await.unwrap_or_else(|e| {
                logging!(error, Type::Cmd, "Failed to fetch provider proxies: {e}");
                serde_json::Value::Object(serde_json::Map::new())
            })
        })
        .await;
    Ok((*value).clone())
}

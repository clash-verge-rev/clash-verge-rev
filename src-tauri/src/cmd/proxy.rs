use super::CmdResult;
use crate::module::mihomo::MihomoManager;
use std::time::Duration;

use crate::state::proxy::ProxyRequestCache;

const PROXIES_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const PROVIDERS_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let manager = MihomoManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    let value = cache
        .get_or_fetch(key, PROXIES_REFRESH_INTERVAL, || async {
            manager.get_refresh_proxies().await.expect("fetch failed")
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
    let manager = MihomoManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("providers", "default");
    let value = cache
        .get_or_fetch(key, PROVIDERS_REFRESH_INTERVAL, || async {
            manager.get_providers_proxies().await.expect("fetch failed")
        })
        .await;
    Ok((*value).clone())
}

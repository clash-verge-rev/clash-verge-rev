use tauri::Emitter;

use super::CmdResult;
use crate::{
    core::{handle::Handle, tray::Tray},
    ipc::IpcManager,
    logging,
    state::proxy::ProxyRequestCache,
    utils::logging::Type,
};
use std::time::Duration;

const PROXIES_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const PROVIDERS_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    let value = cache
        .get_or_fetch(key, PROXIES_REFRESH_INTERVAL, || async {
            let manager = IpcManager::global();
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
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("providers", "default");
    let value = cache
        .get_or_fetch(key, PROVIDERS_REFRESH_INTERVAL, || async {
            let manager = IpcManager::global();
            manager.get_providers_proxies().await.unwrap_or_else(|e| {
                logging!(error, Type::Cmd, "Failed to fetch provider proxies: {e}");
                serde_json::Value::Object(serde_json::Map::new())
            })
        })
        .await;
    Ok((*value).clone())
}

/// 同步托盘和GUI的代理选择状态
#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    use crate::core::tray::Tray;

    match Tray::global().update_menu().await {
        Ok(_) => {
            logging!(info, Type::Cmd, "Tray proxy selection synced successfully");
            Ok(())
        }
        Err(e) => {
            logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e}");
            Err(e.to_string())
        }
    }
}

/// 更新代理选择并同步托盘和GUI状态
#[tauri::command]
pub async fn update_proxy_and_sync(group: String, proxy: String) -> CmdResult<()> {
    match IpcManager::global().update_proxy(&group, &proxy).await {
        Ok(_) => {
            logging!(
                info,
                Type::Cmd,
                "Proxy updated successfully: {} -> {}",
                group,
                proxy
            );

            let cache = crate::state::proxy::ProxyRequestCache::global();
            let key = crate::state::proxy::ProxyRequestCache::make_key("proxies", "default");
            cache.map.remove(&key);

            if let Err(e) = Tray::global().update_menu().await {
                logging!(error, Type::Cmd, "Failed to sync tray menu: {}", e);
            }

            if let Some(app_handle) = Handle::global().app_handle() {
                let _ = app_handle.emit("verge://force-refresh-proxies", ());
                let _ = app_handle.emit("verge://refresh-proxy-config", ());
            }

            logging!(
                info,
                Type::Cmd,
                "Proxy and sync completed successfully: {} -> {}",
                group,
                proxy
            );
            Ok(())
        }
        Err(e) => {
            logging!(
                error,
                Type::Cmd,
                "Failed to update proxy: {} -> {}, error: {}",
                group,
                proxy,
                e
            );
            Err(e.to_string())
        }
    }
}

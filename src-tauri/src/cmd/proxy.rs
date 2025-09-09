use tauri::Emitter;

use super::CmdResult;
use crate::{
    cache::mihomo::{CACHE_PROVIDERS_KEY, CACHE_PROXIES_KEY, MIHOMO_CACHE},
    core::{handle::Handle, tray::Tray},
    ipc::IpcManager,
    logging,
    utils::logging::Type,
};

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let manager = IpcManager::global();
    let value = MIHOMO_CACHE
        .inner()
        .get_with_by_ref(CACHE_PROXIES_KEY, async move {
            Box::new(manager.get_proxies().await.unwrap_or_else(|e| {
                logging!(error, Type::Cmd, "Failed to fetch proxies: {e}");
                serde_json::Value::Object(serde_json::Map::new())
            }))
        })
        .await;
    Ok(*value)
}

/// 强制刷新代理缓存用于profile切换
#[tauri::command]
pub async fn force_refresh_proxies() -> CmdResult<serde_json::Value> {
    MIHOMO_CACHE.inner().invalidate(CACHE_PROXIES_KEY).await;
    get_proxies().await
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let manager = IpcManager::global();
    let value = MIHOMO_CACHE
        .inner()
        .get_with_by_ref(CACHE_PROVIDERS_KEY, async move {
            Box::new(manager.get_providers_proxies().await.unwrap_or_else(|e| {
                logging!(error, Type::Cmd, "Failed to fetch provider proxies: {e}");
                serde_json::Value::Object(serde_json::Map::new())
            }))
        })
        .await;
    Ok(*value)
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
    MIHOMO_CACHE.inner().invalidate(CACHE_PROXIES_KEY).await;

    match IpcManager::global().update_proxy(&group, &proxy).await {
        Ok(_) => {
            logging!(
                info,
                Type::Cmd,
                "Proxy updated successfully: {} -> {}",
                group,
                proxy
            );

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

use super::CmdResult;
<<<<<<< HEAD
use crate::{core::handle, ipc::IpcManager, state::proxy::CmdProxyState};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
=======
use crate::module::mihomo::MihomoManager;
use std::time::Duration;
>>>>>>> dev

use crate::state::proxy::ProxyRequestCache;

const PROXIES_REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const PROVIDERS_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
<<<<<<< HEAD
    let manager = IpcManager::global();

    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cmd_proxy_state = app_handle.state::<Mutex<CmdProxyState>>();

    let should_refresh = {
        let mut state = cmd_proxy_state.lock().unwrap();
        let now = Instant::now();
        if now.duration_since(state.last_refresh_time) > PROXIES_REFRESH_INTERVAL {
            state.need_refresh = true;
            state.last_refresh_time = now;
        }
        state.need_refresh
    };

    if should_refresh {
        let proxies = manager
            .get_refresh_proxies()
            .await
            .map_err(|e| e.to_string())?;
        {
            let mut state = cmd_proxy_state.lock().unwrap();
            state.proxies = Box::new(proxies);
            state.need_refresh = false;
        }
        log::debug!(target: "app", "proxies刷新成功");
    }

    let proxies = {
        let state = cmd_proxy_state.lock().unwrap();
        state.proxies.clone()
    };
    Ok(*proxies)
=======
    let manager = MihomoManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    let value = cache
        .get_or_fetch(key, PROXIES_REFRESH_INTERVAL, || async {
            manager.get_refresh_proxies().await.expect("fetch failed")
        })
        .await;
    Ok((*value).clone())
>>>>>>> dev
}

/// 强制刷新代理缓存用于profile切换
#[tauri::command]
pub async fn force_refresh_proxies() -> CmdResult<serde_json::Value> {
<<<<<<< HEAD
    let manager = IpcManager::global();
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cmd_proxy_state = app_handle.state::<Mutex<CmdProxyState>>();

    log::debug!(target: "app", "强制刷新代理缓存");

    let proxies = manager
        .get_refresh_proxies()
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut state = cmd_proxy_state.lock().unwrap();
        state.proxies = Box::new(proxies.clone());
        state.need_refresh = false;
        state.last_refresh_time = Instant::now();
    }

    log::debug!(target: "app", "强制刷新代理缓存完成");
    Ok(proxies)
=======
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("proxies", "default");
    cache.map.remove(&key);
    get_proxies().await
>>>>>>> dev
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
<<<<<<< HEAD
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cmd_proxy_state = app_handle.state::<Mutex<CmdProxyState>>();

    let should_refresh = {
        let mut state = cmd_proxy_state.lock().unwrap();
        let now = Instant::now();
        if now.duration_since(state.last_refresh_time) > PROVIDERS_REFRESH_INTERVAL {
            state.need_refresh = true;
            state.last_refresh_time = now;
        }
        state.need_refresh
    };

    if should_refresh {
        let manager = IpcManager::global();
        let providers = manager
            .get_providers_proxies()
            .await
            .map_err(|e| e.to_string())?;
        {
            let mut state = cmd_proxy_state.lock().unwrap();
            state.providers_proxies = Box::new(providers);
            state.need_refresh = false;
        }
        log::debug!(target: "app", "providers_proxies刷新成功");
    }

    let providers_proxies = {
        let state = cmd_proxy_state.lock().unwrap();
        state.providers_proxies.clone()
    };
    Ok(*providers_proxies)
=======
    let manager = MihomoManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("providers", "default");
    let value = cache
        .get_or_fetch(key, PROVIDERS_REFRESH_INTERVAL, || async {
            manager.get_providers_proxies().await.expect("fetch failed")
        })
        .await;
    Ok((*value).clone())
>>>>>>> dev
}

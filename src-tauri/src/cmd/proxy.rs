use super::CmdResult;
use crate::{core::handle, module::mihomo::MihomoManager, state::proxy::CmdProxyState};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

const PROVIDERS_REFRESH_INTERVAL: Duration = Duration::from_secs(3);
const PROXIES_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let manager = MihomoManager::global();

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
        let proxies = manager.get_refresh_proxies().await?;
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
}

/// 强制刷新代理缓存用于profile切换
#[tauri::command]
pub async fn force_refresh_proxies() -> CmdResult<serde_json::Value> {
    let manager = MihomoManager::global();
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cmd_proxy_state = app_handle.state::<Mutex<CmdProxyState>>();

    log::debug!(target: "app", "强制刷新代理缓存");

    let proxies = manager.get_refresh_proxies().await?;

    {
        let mut state = cmd_proxy_state.lock().unwrap();
        state.proxies = Box::new(proxies.clone());
        state.need_refresh = false;
        state.last_refresh_time = Instant::now();
    }

    log::debug!(target: "app", "强制刷新代理缓存完成");
    Ok(proxies)
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
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
        let manager = MihomoManager::global();
        let providers = manager.get_providers_proxies().await?;
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
}

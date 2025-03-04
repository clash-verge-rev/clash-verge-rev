use super::CmdResult;
use crate::core;
use mihomo_api;


#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let (mihomo_server, _) = core::clash_api::clash_client_info().unwrap();
    let mihomo = mihomo_api::MihomoManager::new(mihomo_server);
    Ok(mihomo
        .refresh_proxies()
        .await
        .unwrap()
        .get_proxies())
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let (mihomo_server, _) = core::clash_api::clash_client_info().unwrap();
    let mihomo = mihomo_api::MihomoManager::new(mihomo_server);
    Ok(mihomo
        .refresh_providers_proxies()
        .await
        .unwrap()
        .get_providers_proxies())
}

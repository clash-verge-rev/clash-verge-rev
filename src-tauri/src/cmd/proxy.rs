use super::CmdResult;
use crate::module::mihomo::MihomoManager;
use tauri::async_runtime;

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let proxies = async_runtime::spawn_blocking(|| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let manager = MihomoManager::new();
        {
            let mut write_guard = manager.write();
            rt.block_on(write_guard.refresh_proxies());
        }
        let read_guard = manager.read();
        read_guard.fetch_proxies().clone()
    })
    .await.map_err(|e| e.to_string())?;
    Ok(proxies)
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let providers_proxies = async_runtime::spawn_blocking(|| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let manager = MihomoManager::new();
        {
            let mut write_guard = manager.write();
            rt.block_on(write_guard.refresh_providers_proxies());
        }
        let read_guard = manager.read();
        read_guard.fetch_providers_proxies().clone()
    })
    .await.map_err(|e| e.to_string())?;
    Ok(providers_proxies)
}
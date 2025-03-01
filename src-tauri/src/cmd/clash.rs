use crate::{
    config::*,
    core::*,
    feat,
    wrap_err,
};
use super::CmdResult;
use serde_yaml::Mapping;

/// 复制Clash环境变量
#[tauri::command]
pub fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env();
    Ok(())
}

/// 获取Clash信息
#[tauri::command]
pub fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().latest().get_client_info())
}

/// 修改Clash配置
#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

/// 修改Clash模式
#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    Ok(feat::change_clash_mode(payload))
}

/// 切换Clash核心
#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    log::info!(target: "app", "changing core to {clash_core}");
    
    match CoreManager::global().change_core(Some(clash_core.clone())).await {
        Ok(_) => {
            log::info!(target: "app", "core changed to {clash_core}");
            handle::Handle::notice_message("config_core::change_success", &clash_core);
            handle::Handle::refresh_clash();
            Ok(None)
        }
        Err(err) => {
            let error_msg = err.to_string();
            log::error!(target: "app", "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", &error_msg);
            Ok(Some(error_msg))
        }
    }
}

/// 重启核心
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    wrap_err!(CoreManager::global().restart_core().await)
}

/// 获取代理延迟
#[tauri::command]
pub async fn clash_api_get_proxy_delay(
    name: String,
    url: Option<String>,
    timeout: i32,
) -> CmdResult<clash_api::DelayRes> {
    match clash_api::get_proxy_delay(name, url, timeout).await {
        Ok(res) => Ok(res),
        Err(err) => Err(err.to_string()),
    }
}

/// 测试URL延迟
#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    Ok(feat::test_delay(url).await.unwrap_or(10000u32))
}

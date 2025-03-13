use super::CmdResult;
use crate::{config::*, core::*, feat, module::mihomo::MihomoManager, wrap_err};
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
    feat::change_clash_mode(payload);
    Ok(())
}

/// 切换Clash核心
#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    log::info!(target: "app", "changing core to {clash_core}");

    match CoreManager::global()
        .change_core(Some(clash_core.clone()))
        .await
    {
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
) -> CmdResult<serde_json::Value> {
    MihomoManager::global()
        .test_proxy_delay(&name, url, timeout)
        .await
}

/// 测试URL延迟
#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    Ok(feat::test_delay(url).await.unwrap_or(10000u32))
}

/// 保存DNS配置到单独文件
#[tauri::command]
pub async fn save_dns_config(dns_config: Mapping) -> CmdResult {
    use crate::utils::dirs;
    use serde_yaml;
    use std::fs;

    // 获取DNS配置文件路径
    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    // 保存DNS配置到文件
    let yaml_str = serde_yaml::to_string(&dns_config).map_err(|e| e.to_string())?;
    fs::write(&dns_path, yaml_str).map_err(|e| e.to_string())?;
    log::info!(target: "app", "DNS config saved to {:?}", dns_path);

    Ok(())
}

/// 应用或撤销DNS配置
#[tauri::command]
pub fn apply_dns_config(apply: bool) -> CmdResult {
    use crate::{
        config::Config,
        core::{handle, CoreManager},
        utils::dirs,
    };
    use tauri::async_runtime;

    // 使用spawn来处理异步操作
    async_runtime::spawn(async move {
        if apply {
            // 读取DNS配置文件
            let dns_path = match dirs::app_home_dir() {
                Ok(path) => path.join("dns_config.yaml"),
                Err(e) => {
                    log::error!(target: "app", "Failed to get home dir: {}", e);
                    return;
                }
            };

            if !dns_path.exists() {
                log::warn!(target: "app", "DNS config file not found");
                return;
            }

            let dns_yaml = match std::fs::read_to_string(&dns_path) {
                Ok(content) => content,
                Err(e) => {
                    log::error!(target: "app", "Failed to read DNS config: {}", e);
                    return;
                }
            };

            // 解析DNS配置并创建patch
            let patch_config = match serde_yaml::from_str::<serde_yaml::Mapping>(&dns_yaml) {
                Ok(config) => {
                    let mut patch = serde_yaml::Mapping::new();
                    patch.insert("dns".into(), config.into());
                    patch
                }
                Err(e) => {
                    log::error!(target: "app", "Failed to parse DNS config: {}", e);
                    return;
                }
            };

            log::info!(target: "app", "Applying DNS config from file");

            // 重新生成配置，确保DNS配置被正确应用
            // 这里不调用patch_clash以避免将DNS配置写入config.yaml
            Config::runtime()
                .latest()
                .patch_config(patch_config.clone());

            // 首先重新生成配置
            if let Err(err) = Config::generate().await {
                log::error!(target: "app", "Failed to regenerate config with DNS: {}", err);
                return;
            }

            // 然后应用新配置
            if let Err(err) = CoreManager::global().update_config().await {
                log::error!(target: "app", "Failed to apply config with DNS: {}", err);
            } else {
                log::info!(target: "app", "DNS config successfully applied");
                handle::Handle::refresh_clash();
            }
        } else {
            // 当关闭DNS设置时，不需要对配置进行任何修改
            // 直接重新生成配置，让enhance函数自动跳过DNS配置的加载
            log::info!(target: "app", "DNS settings disabled, regenerating config");

            // 重新生成配置
            if let Err(err) = Config::generate().await {
                log::error!(target: "app", "Failed to regenerate config: {}", err);
                return;
            }

            // 应用新配置
            match CoreManager::global().update_config().await {
                Ok(_) => {
                    log::info!(target: "app", "Config regenerated successfully");
                    handle::Handle::refresh_clash();
                }
                Err(err) => {
                    log::error!(target: "app", "Failed to apply regenerated config: {}", err);
                }
            }
        }
    });

    Ok(())
}

/// 检查DNS配置文件是否存在
#[tauri::command]
pub fn check_dns_config_exists() -> CmdResult<bool> {
    use crate::utils::dirs;

    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    Ok(dns_path.exists())
}

/// 获取DNS配置文件内容
#[tauri::command]
pub async fn get_dns_config_content() -> CmdResult<String> {
    use crate::utils::dirs;
    use std::fs;

    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    if !dns_path.exists() {
        return Err("DNS config file not found".into());
    }

    let content = fs::read_to_string(&dns_path).map_err(|e| e.to_string())?;
    Ok(content)
}

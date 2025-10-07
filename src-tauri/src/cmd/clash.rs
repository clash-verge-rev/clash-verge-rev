use std::collections::VecDeque;

use super::CmdResult;
use crate::{
    config::Config,
    core::{self, CoreManager, RunningMode, handle, logger},
};
use crate::{config::*, feat, logging, utils::logging::Type, wrap_err};
use serde_yaml_ng::Mapping;
// use std::time::Duration;

// const CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// 复制Clash环境变量
#[tauri::command]
pub async fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env().await;
    Ok(())
}

/// 获取Clash信息
#[tauri::command]
pub async fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().await.latest_ref().get_client_info())
}

/// 修改Clash配置
#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

/// 修改Clash模式
#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    feat::change_clash_mode(payload).await;
    Ok(())
}

/// 切换Clash核心
#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    logging!(info, Type::Config, "changing core to {clash_core}");

    match CoreManager::global()
        .change_core(Some(clash_core.clone()))
        .await
    {
        Ok(_) => {
            // 切换内核后重启内核
            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    logging!(
                        info,
                        Type::Core,
                        "core changed and restarted to {clash_core}"
                    );
                    handle::Handle::notice_message("config_core::change_success", &clash_core);
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let error_msg = format!("Core changed but failed to restart: {err}");
                    logging!(error, Type::Core, "{error_msg}");
                    handle::Handle::notice_message("config_core::change_error", &error_msg);
                    Ok(Some(error_msg))
                }
            }
        }
        Err(err) => {
            let error_msg = err.to_string();
            logging!(error, Type::Core, "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", &error_msg);
            Ok(Some(error_msg))
        }
    }
}

/// 启动核心
#[tauri::command]
pub async fn start_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().start_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 关闭核心
#[tauri::command]
pub async fn stop_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().stop_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 重启核心
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().restart_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 测试URL延迟
#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    let result = match feat::test_delay(url).await {
        Ok(delay) => delay,
        Err(e) => {
            log::error!(target: "app", "{}", e);
            10000u32
        }
    };
    Ok(result)
}

/// 保存DNS配置到单独文件
#[tauri::command]
pub async fn save_dns_config(dns_config: Mapping) -> CmdResult {
    use crate::utils::dirs;
    use serde_yaml_ng;
    use tokio::fs;

    // 获取DNS配置文件路径
    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    // 保存DNS配置到文件
    let yaml_str = serde_yaml_ng::to_string(&dns_config).map_err(|e| e.to_string())?;
    fs::write(&dns_path, yaml_str)
        .await
        .map_err(|e| e.to_string())?;
    logging!(info, Type::Config, "DNS config saved to {dns_path:?}");

    Ok(())
}

/// 应用或撤销DNS配置
#[tauri::command]
pub async fn apply_dns_config(apply: bool) -> CmdResult {
    use crate::{
        config::Config,
        core::{CoreManager, handle},
        utils::dirs,
    };

    if apply {
        // 读取DNS配置文件
        let dns_path = dirs::app_home_dir()
            .map_err(|e| e.to_string())?
            .join("dns_config.yaml");

        if !dns_path.exists() {
            logging!(warn, Type::Config, "DNS config file not found");
            return Err("DNS config file not found".into());
        }

        let dns_yaml = tokio::fs::read_to_string(&dns_path).await.map_err(|e| {
            logging!(error, Type::Config, "Failed to read DNS config: {e}");
            e.to_string()
        })?;

        // 解析DNS配置
        let patch_config =
            serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml).map_err(|e| {
                logging!(error, Type::Config, "Failed to parse DNS config: {e}");
                e.to_string()
            })?;

        logging!(info, Type::Config, "Applying DNS config from file");

        // 创建包含DNS配置的patch
        let mut patch = serde_yaml_ng::Mapping::new();
        patch.insert("dns".into(), patch_config.into());

        // 应用DNS配置到运行时配置
        Config::runtime().await.draft_mut().patch_config(patch);

        // 重新生成配置
        Config::generate().await.map_err(|err| {
            logging!(
                error,
                Type::Config,
                "Failed to regenerate config with DNS: {err}"
            );
            "Failed to regenerate config with DNS".to_string()
        })?;

        // 应用新配置
        CoreManager::global().update_config().await.map_err(|err| {
            logging!(
                error,
                Type::Config,
                "Failed to apply config with DNS: {err}"
            );
            "Failed to apply config with DNS".to_string()
        })?;

        logging!(info, Type::Config, "DNS config successfully applied");
        handle::Handle::refresh_clash();
    } else {
        // 当关闭DNS设置时，重新生成配置（不加载DNS配置文件）
        logging!(
            info,
            Type::Config,
            "DNS settings disabled, regenerating config"
        );

        Config::generate().await.map_err(|err| {
            logging!(error, Type::Config, "Failed to regenerate config: {err}");
            "Failed to regenerate config".to_string()
        })?;

        CoreManager::global().update_config().await.map_err(|err| {
            logging!(
                error,
                Type::Config,
                "Failed to apply regenerated config: {err}"
            );
            "Failed to apply regenerated config".to_string()
        })?;

        logging!(info, Type::Config, "Config regenerated successfully");
        handle::Handle::refresh_clash();
    }

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
    use tokio::fs;

    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    if !fs::try_exists(&dns_path).await.map_err(|e| e.to_string())? {
        return Err("DNS config file not found".into());
    }

    let content = fs::read_to_string(&dns_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(content)
}

/// 验证DNS配置文件
#[tauri::command]
pub async fn validate_dns_config() -> CmdResult<(bool, String)> {
    use crate::{core::CoreManager, utils::dirs};

    let app_dir = dirs::app_home_dir().map_err(|e| e.to_string())?;
    let dns_path = app_dir.join("dns_config.yaml");
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok((false, "DNS config file not found".to_string()));
    }

    match CoreManager::global()
        .validate_config_file(dns_path_str, None)
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_clash_logs() -> CmdResult<VecDeque<String>> {
    let logs = match core::CoreManager::global().get_running_mode() {
        // TODO: 服务模式下日志获取接口
        RunningMode::Service => VecDeque::new(),
        RunningMode::Sidecar => logger::Logger::global().get_logs().clone(),
        _ => VecDeque::new(),
    };
    Ok(logs)
}

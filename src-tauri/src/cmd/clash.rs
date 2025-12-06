use super::CmdResult;
use crate::feat;
use crate::utils::dirs;
use crate::{
    cmd::StringifyErr as _,
    config::{ClashInfo, Config},
    constants,
    core::{CoreManager, handle, validate::CoreConfigValidator},
};
use clash_verge_logging::{Type, logging, logging_error};
use compact_str::CompactString;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use tokio::fs;

/// 复制Clash环境变量
#[tauri::command]
pub async fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env().await;
    Ok(())
}

/// 获取Clash信息
#[tauri::command]
pub async fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().await.data_arc().get_client_info())
}

/// 修改Clash配置
#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    feat::patch_clash(&payload).await.stringify_err()
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

    match CoreManager::global().change_core(&clash_core).await {
        Ok(_) => {
            logging_error!(Type::Core, Config::profiles().await.latest_arc().save_file().await);

            // 切换内核后重启内核
            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    logging!(info, Type::Core, "core changed and restarted to {clash_core}");
                    handle::Handle::notice_message("config_core::change_success", clash_core);
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let error_msg: String = format!("Core changed but failed to restart: {err}").into();
                    handle::Handle::notice_message("config_core::change_error", error_msg.clone());
                    logging!(error, Type::Core, "{error_msg}");
                    Ok(Some(error_msg))
                }
            }
        }
        Err(err) => {
            let error_msg: String = err;
            logging!(error, Type::Core, "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", error_msg.clone());
            Ok(Some(error_msg))
        }
    }
}

/// 启动核心
#[tauri::command]
pub async fn start_core() -> CmdResult {
    let result = CoreManager::global().start_core().await.stringify_err();
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 关闭核心
#[tauri::command]
pub async fn stop_core() -> CmdResult {
    logging_error!(Type::Core, Config::profiles().await.latest_arc().save_file().await);
    let result = CoreManager::global().stop_core().await.stringify_err();
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 重启核心
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    logging_error!(Type::Core, Config::profiles().await.latest_arc().save_file().await);
    let result = CoreManager::global().restart_core().await.stringify_err();
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
            logging!(error, Type::Cmd, "{}", e);
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
    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    // 保存DNS配置到文件
    let yaml_str = serde_yaml_ng::to_string(&dns_config).stringify_err()?;
    fs::write(&dns_path, yaml_str).await.stringify_err()?;
    logging!(info, Type::Config, "DNS config saved to {dns_path:?}");

    Ok(())
}

/// 应用或撤销DNS配置
#[tauri::command]
pub async fn apply_dns_config(apply: bool) -> CmdResult {
    if apply {
        // 读取DNS配置文件
        let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

        if !dns_path.exists() {
            logging!(warn, Type::Config, "DNS config file not found");
            return Err("DNS config file not found".into());
        }

        let dns_yaml = fs::read_to_string(&dns_path).await.stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to read DNS config: {e}");
        })?;

        // 解析DNS配置
        let patch_config = serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml).stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to parse DNS config: {e}");
        })?;

        logging!(info, Type::Config, "Applying DNS config from file");

        // 创建包含DNS配置的patch
        let mut patch = serde_yaml_ng::Mapping::new();
        patch.insert("dns".into(), patch_config.into());

        // 应用DNS配置到运行时配置
        Config::runtime().await.edit_draft(|d| {
            d.patch_config(&patch);
        });

        // 重新生成配置
        Config::generate().await.stringify_err_log(|err| {
            let err = format!("Failed to regenerate config with DNS: {err}");
            logging!(error, Type::Config, "{err}");
        })?;

        // 应用新配置
        CoreManager::global().update_config().await.stringify_err_log(|err| {
            let err = format!("Failed to apply config with DNS: {err}");
            logging!(error, Type::Config, "{err}");
        })?;

        logging!(info, Type::Config, "DNS config successfully applied");
    } else {
        // 当关闭DNS设置时，重新生成配置（不加载DNS配置文件）
        logging!(info, Type::Config, "DNS settings disabled, regenerating config");

        Config::generate().await.stringify_err_log(|err| {
            let err = format!("Failed to regenerate config: {err}");
            logging!(error, Type::Config, "{err}");
        })?;

        CoreManager::global().update_config().await.stringify_err_log(|err| {
            let err = format!("Failed to apply regenerated config: {err}");
            logging!(error, Type::Config, "{err}");
        })?;

        logging!(info, Type::Config, "Config regenerated successfully");
    }

    handle::Handle::refresh_clash();
    Ok(())
}

/// 检查DNS配置文件是否存在
#[tauri::command]
pub fn check_dns_config_exists() -> CmdResult<bool> {
    use crate::utils::dirs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    Ok(dns_path.exists())
}

/// 获取DNS配置文件内容
#[tauri::command]
pub async fn get_dns_config_content() -> CmdResult<String> {
    use crate::utils::dirs;
    use tokio::fs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    if !fs::try_exists(&dns_path).await.stringify_err()? {
        return Err("DNS config file not found".into());
    }

    let content = fs::read_to_string(&dns_path).await.stringify_err()?.into();
    Ok(content)
}

/// 验证DNS配置文件
#[tauri::command]
pub async fn validate_dns_config() -> CmdResult<(bool, String)> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    let dns_path = app_dir.join(constants::files::DNS_CONFIG);
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok((false, "DNS config file not found".into()));
    }

    CoreConfigValidator::validate_config_file(dns_path_str, None)
        .await
        .stringify_err()
}

#[tauri::command]
pub async fn get_clash_logs() -> CmdResult<Vec<CompactString>> {
    let logs = CoreManager::global().get_clash_logs().await.unwrap_or_default();
    Ok(logs)
}

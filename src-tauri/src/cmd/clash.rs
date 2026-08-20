use super::{CmdResult, CommandFailure, WithErrorCode as _, proxy_aware_coded_error, proxy_aware_error};
use crate::feat;
use crate::utils::{dirs, yaml_emitter};
use crate::{
    cmd::StringifyErr as _,
    config::{ClashInfo, Config, profiles::profiles_save_file_safe},
    constants,
    core::{
        CoreManager, handle,
        validate::{CoreConfigValidator, ValidationOutcome},
    },
};
use clash_verge_logging::{Type, logging, logging_error};
use compact_str::CompactString;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use tokio::fs;

#[tauri::command]
pub async fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env().await;
    Ok(())
}

#[tauri::command]
pub async fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().await.data_arc().get_client_info())
}

#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    feat::patch_clash(&payload)
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CLASH_CONFIG_UPDATE_FAILED"))
}

#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    feat::change_clash_mode(payload)
        .await
        .with_error_code("CLASH_MODE_UPDATE_FAILED")
}

/// Reads the saved mode without depending on strict mihomo `/configs` deserialization.
#[tauri::command]
pub async fn get_clash_mode() -> CmdResult<Option<String>> {
    Ok(Config::clash().await.data_arc().get_mode().map(Into::into))
}

#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<CommandFailure>> {
    logging!(info, Type::Config, "changing core to {clash_core}");

    match CoreManager::global().change_core(&clash_core).await {
        Ok(_) => {
            logging_error!(Type::Core, profiles_save_file_safe().await);

            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    logging!(info, Type::Core, "core changed and restarted to {clash_core}");
                    handle::Handle::notice_message("config_core::change_success", clash_core);
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let failed = err.context("core changed but failed to restart");
                    let error_msg: String = format!("{failed:#}").into();
                    handle::Handle::notice_message("config_core::change_error", error_msg.clone());
                    logging!(error, Type::Core, "{error_msg}");
                    Ok(Some(proxy_aware_coded_error(&failed, "CORE_CHANGE_FAILED")))
                }
            }
        }
        Err(err) => {
            let error_msg: String = format!("{err:#}").into();
            logging!(error, Type::Core, "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", error_msg);
            Ok(Some(proxy_aware_coded_error(&err, "CORE_CHANGE_FAILED")))
        }
    }
}

#[tauri::command]
pub async fn start_core() -> CmdResult {
    let result = CoreManager::global()
        .start_core()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CORE_START_FAILED"));
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

#[tauri::command]
pub async fn stop_core() -> CmdResult {
    logging_error!(Type::Core, profiles_save_file_safe().await);
    let result = CoreManager::global()
        .stop_core()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CORE_STOP_FAILED"));
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

#[tauri::command]
pub async fn restart_core() -> CmdResult {
    logging_error!(Type::Core, profiles_save_file_safe().await);
    let result = CoreManager::global()
        .restart_core()
        .await
        .map_err(|error| proxy_aware_coded_error(&error, "CORE_RESTART_FAILED"));
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

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

#[tauri::command]
pub async fn save_dns_config(dns_config: Mapping) -> CmdResult {
    use crate::utils::dirs;
    use tokio::fs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    let yaml_str = yaml_emitter::to_mihomo_config_string(&dns_config).stringify_err()?;
    fs::write(&dns_path, yaml_str).await.stringify_err()?;
    logging!(info, Type::Config, "DNS config saved to {dns_path:?}");

    Ok(())
}

#[tauri::command]
pub async fn apply_dns_config(apply: bool) -> CmdResult {
    if apply {
        let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

        if !dns_path.exists() {
            logging!(warn, Type::Config, "DNS config file not found");
            return Err("DNS config file not found".into());
        }

        let dns_yaml = fs::read_to_string(&dns_path).await.stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to read DNS config: {e}");
        })?;

        let patch_config = serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&dns_yaml).stringify_err_log(|e| {
            logging!(error, Type::Config, "Failed to parse DNS config: {e}");
        })?;

        logging!(info, Type::Config, "Applying DNS config from file");

        let mut patch = serde_yaml_ng::Mapping::new();
        patch.insert("dns".into(), patch_config.into());

        Config::runtime().await.edit_draft(|d| {
            d.patch_config(&patch);
        });

        CoreManager::global().update_config_checked().await.map_err(|error| {
            logging!(error, Type::Config, "failed to apply the config with DNS: {error:#}");
            proxy_aware_error(&error)
        })?;

        logging!(info, Type::Config, "DNS config successfully applied");
    } else {
        logging!(info, Type::Config, "DNS settings disabled, regenerating config");

        CoreManager::global().update_config_checked().await.map_err(|error| {
            logging!(error, Type::Config, "failed to apply the regenerated config: {error:#}");
            proxy_aware_error(&error)
        })?;

        logging!(info, Type::Config, "Config regenerated successfully");
    }

    handle::Handle::refresh_clash();
    Ok(())
}

#[tauri::command]
pub fn check_dns_config_exists() -> CmdResult<bool> {
    use crate::utils::dirs;

    let dns_path = dirs::app_home_dir().stringify_err()?.join(constants::files::DNS_CONFIG);

    Ok(dns_path.exists())
}

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

#[tauri::command]
pub async fn validate_dns_config() -> CmdResult<ValidationOutcome> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    let dns_path = app_dir.join(constants::files::DNS_CONFIG);
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok(ValidationOutcome::invalid_from_message("DNS config file not found"));
    }

    CoreConfigValidator::validate_config_file_outcome(dns_path_str, None)
        .await
        .stringify_err()
}

#[tauri::command]
pub async fn get_clash_logs() -> CmdResult<Vec<CompactString>> {
    let logs = CoreManager::global().get_clash_logs().await.unwrap_or_default();
    Ok(logs)
}

use super::{IClashTemp, IProfiles, IVerge};
use crate::{
    config::{PrfItem, profiles_append_item_safe},
    constants::{files, timing},
    core::{
        CoreManager,
        handle::{self, Handle},
        service, tray,
        validate::CoreConfigValidator,
    },
    enhance,
    process::AsyncHandler,
    utils::{dirs, help},
};
use anyhow::{Result, anyhow};
use backoff::{Error as BackoffError, ExponentialBackoff};
use clash_verge_draft::Draft;
use clash_verge_logging::{Type, logging, logging_error};
use clash_verge_types::runtime::IRuntime;
use smartstring::alias::String;
use std::path::PathBuf;
use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;
use tokio::sync::OnceCell;
use tokio::time::sleep;

pub struct Config {
    clash_config: Draft<IClashTemp>,
    verge_config: Draft<IVerge>,
    profiles_config: Draft<IProfiles>,
    runtime_config: Draft<IRuntime>,
}

impl Config {
    pub async fn global() -> &'static Self {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Self {
                    clash_config: Draft::new(IClashTemp::new().await),
                    verge_config: Draft::new(IVerge::new().await),
                    profiles_config: Draft::new(IProfiles::new().await),
                    runtime_config: Draft::new(IRuntime::new()),
                }
            })
            .await
    }

    pub async fn clash() -> Draft<IClashTemp> {
        Self::global().await.clash_config.clone()
    }

    pub async fn verge() -> Draft<IVerge> {
        Self::global().await.verge_config.clone()
    }

    pub async fn profiles() -> Draft<IProfiles> {
        Self::global().await.profiles_config.clone()
    }

    pub async fn runtime() -> Draft<IRuntime> {
        Self::global().await.runtime_config.clone()
    }

    /// 初始化订阅
    pub async fn init_config() -> Result<()> {
        Self::ensure_default_profile_items().await?;

        // init Tun mode
        let handle = Handle::app_handle();
        let is_admin = is_current_app_handle_admin(handle);
        let is_service_available = service::is_service_available().await.is_ok();
        if !is_admin && !is_service_available {
            let verge = Self::verge().await;
            verge.edit_draft(|d| {
                d.enable_tun_mode = Some(false);
            });
            verge.apply();
            let _ = tray::Tray::global().update_menu().await;

            // 分离数据获取和异步调用避免Send问题
            let verge_data = Self::verge().await.latest_arc();
            logging_error!(Type::Core, verge_data.save_file().await);
        }

        let validation_result = Self::generate_and_validate().await?;

        if let Some((msg_type, msg_content)) = validation_result {
            sleep(timing::STARTUP_ERROR_DELAY).await;
            handle::Handle::notice_message(msg_type, msg_content);
        }

        Ok(())
    }

    // Ensure "Merge" and "Script" profile items exist, adding them if missing.
    async fn ensure_default_profile_items() -> Result<()> {
        let profiles = Self::profiles().await;
        if profiles.latest_arc().get_item("Merge").is_err() {
            let merge_item = &mut PrfItem::from_merge(Some("Merge".into()))?;
            profiles_append_item_safe(merge_item).await?;
        }
        if profiles.latest_arc().get_item("Script").is_err() {
            let script_item = &mut PrfItem::from_script(Some("Script".into()))?;
            profiles_append_item_safe(script_item).await?;
        }
        Ok(())
    }

    async fn generate_and_validate() -> Result<Option<(&'static str, String)>> {
        // 生成运行时配置
        if let Err(err) = Self::generate().await {
            logging!(error, Type::Config, "生成运行时配置失败: {}", err);
        } else {
            logging!(info, Type::Config, "生成运行时配置成功");
        }

        // 生成运行时配置文件并验证
        let config_result = Self::generate_file(ConfigType::Run).await;

        if config_result.is_ok() {
            // 验证配置文件
            logging!(info, Type::Config, "开始验证配置");

            match CoreConfigValidator::global().validate_config().await {
                Ok((is_valid, error_msg)) => {
                    if !is_valid {
                        logging!(
                            warn,
                            Type::Config,
                            "[首次启动] 配置验证失败，使用默认最小配置启动: {}",
                            error_msg
                        );
                        CoreManager::global()
                            .use_default_config("config_validate::boot_error", &error_msg)
                            .await?;
                        Ok(Some(("config_validate::boot_error", error_msg)))
                    } else {
                        logging!(info, Type::Config, "配置验证成功");
                        // 前端没有必要知道验证成功的消息，也没有事件驱动
                        // Some(("config_validate::success", String::new()))
                        Ok(None)
                    }
                }
                Err(err) => {
                    logging!(warn, Type::Config, "验证过程执行失败: {}", err);
                    CoreManager::global()
                        .use_default_config("config_validate::process_terminated", "")
                        .await?;
                    Ok(Some(("config_validate::process_terminated", String::new())))
                }
            }
        } else {
            logging!(warn, Type::Config, "生成配置文件失败，使用默认配置");
            CoreManager::global()
                .use_default_config("config_validate::error", "")
                .await?;
            Ok(Some(("config_validate::error", String::new())))
        }
    }

    pub async fn generate_file(typ: ConfigType) -> Result<PathBuf> {
        let path = match typ {
            ConfigType::Run => dirs::app_home_dir()?.join(files::RUNTIME_CONFIG),
            ConfigType::Check => dirs::app_home_dir()?.join(files::CHECK_CONFIG),
        };

        let runtime = Self::runtime().await;
        let runtime_arc = runtime.latest_arc();
        let config = runtime_arc
            .config
            .as_ref()
            .ok_or_else(|| anyhow!("failed to get runtime config"))?;

        help::save_yaml(&path, config, Some("# Generated by Clash Verge")).await?;
        Ok(path)
    }

    pub async fn generate() -> Result<()> {
        let (config, exists_keys, logs) = enhance::enhance().await;

        Self::runtime().await.edit_draft(|d| {
            *d = IRuntime {
                config: Some(config),
                exists_keys,
                chain_logs: logs,
            }
        });

        Ok(())
    }

    pub async fn verify_config_initialization() {
        let backoff_strategy = ExponentialBackoff {
            initial_interval: std::time::Duration::from_millis(100),
            max_interval: std::time::Duration::from_secs(2),
            max_elapsed_time: Some(std::time::Duration::from_secs(10)),
            multiplier: 2.0,
            ..Default::default()
        };

        let operation = || async {
            if Self::runtime().await.latest_arc().config.is_some() {
                return Ok::<(), BackoffError<anyhow::Error>>(());
            }

            Self::generate().await.map_err(BackoffError::transient)
        };

        if let Err(e) = backoff::future::retry(backoff_strategy, operation).await {
            logging!(error, Type::Setup, "Config init verification failed: {}", e);
        }
    }

    // 升级草稿为正式数据，并写入文件。避免用户行为丢失。
    // 仅在应用退出、重启、关机监听事件启用
    pub async fn apply_all_and_save_file() {
        logging!(info, Type::Config, "save all draft data");
        let save_clash_task = AsyncHandler::spawn(|| async {
            let clash = Self::clash().await;
            clash.apply();
            logging_error!(Type::Config, clash.data_arc().save_config().await);
        });

        let save_verge_task = AsyncHandler::spawn(|| async {
            let verge = Self::verge().await;
            verge.apply();
            logging_error!(Type::Config, verge.data_arc().save_file().await);
        });

        let save_profiles_task = AsyncHandler::spawn(|| async {
            let profiles = Self::profiles().await;
            profiles.apply();
            logging_error!(Type::Config, profiles.data_arc().save_file().await);
        });

        let _ = tokio::join!(save_clash_task, save_verge_task, save_profiles_task);
        logging!(info, Type::Config, "save all draft data finished");
    }
}

#[derive(Debug)]
pub enum ConfigType {
    Run,
    Check,
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::mem;

    #[test]
    #[allow(unused_variables)]
    #[allow(clippy::expect_used)]
    fn test_prfitem_from_merge_size() {
        let merge_item = PrfItem::from_merge(Some("Merge".into())).expect("Failed to create merge item in test");
        let prfitem_size = mem::size_of_val(&merge_item);
        // Boxed version
        let boxed_merge_item = Box::new(merge_item);
        let box_prfitem_size = mem::size_of_val(&boxed_merge_item);
        // The size of Box<T> is always pointer-sized (usually 8 bytes on 64-bit)
        // assert_eq!(box_prfitem_size, mem::size_of::<Box<PrfItem>>());
        assert!(box_prfitem_size < prfitem_size);
    }

    #[test]
    #[allow(unused_variables)]
    fn test_draft_size_non_boxed() {
        let draft = Draft::new(IRuntime::new());
        let iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(iruntime_size, std::mem::size_of::<Draft<IRuntime>>());
    }

    #[test]
    #[allow(unused_variables)]
    fn test_draft_size_boxed() {
        let draft = Draft::new(Box::new(IRuntime::new()));
        let box_iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(box_iruntime_size, std::mem::size_of::<Draft<Box<IRuntime>>>());
    }
}

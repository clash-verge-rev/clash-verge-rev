use super::{IClashTemp, IProfiles, IRuntime, IVerge};
use crate::{
    config::{PrfItem, profiles_append_item_safe},
    constants::{files, timing},
    core::{CoreManager, handle, validate::CoreConfigValidator},
    enhance, logging,
    utils::{Draft, dirs, help, logging::Type},
};
use anyhow::{anyhow, Result};
use backoff::{Error as BackoffError, ExponentialBackoff};
use std::path::PathBuf;
use tokio::sync::OnceCell;
use tokio::time::sleep;

pub struct Config {
    clash_config: Draft<Box<IClashTemp>>,
    verge_config: Draft<Box<IVerge>>,
    profiles_config: Draft<Box<IProfiles>>,
    runtime_config: Draft<Box<IRuntime>>,
}

impl Config {
    pub async fn global() -> &'static Config {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Config {
                    clash_config: Draft::from(Box::new(IClashTemp::new().await)),
                    verge_config: Draft::from(Box::new(IVerge::new().await)),
                    profiles_config: Draft::from(Box::new(IProfiles::new().await)),
                    runtime_config: Draft::from(Box::new(IRuntime::new())),
                }
            })
            .await
    }

    pub async fn clash() -> Draft<Box<IClashTemp>> {
        Self::global().await.clash_config.clone()
    }

    pub async fn verge() -> Draft<Box<IVerge>> {
        Self::global().await.verge_config.clone()
    }

    pub async fn profiles() -> Draft<Box<IProfiles>> {
        Self::global().await.profiles_config.clone()
    }

    pub async fn runtime() -> Draft<Box<IRuntime>> {
        Self::global().await.runtime_config.clone()
    }

    pub async fn init_config() -> Result<()> {
        if Self::profiles()
            .await
            .latest_ref()
            .get_item(&"Merge".into())
            .is_err()
        {
            let merge_item = PrfItem::from_merge(Some("Merge".into()))?;
            profiles_append_item_safe(merge_item.clone()).await?;
        }
        if Self::profiles()
            .await
            .latest_ref()
            .get_item(&"Script".into())
            .is_err()
        {
            let script_item = PrfItem::from_script(Some("Script".into()))?;
            profiles_append_item_safe(script_item.clone()).await?;
        }

        if let Err(err) = Self::generate().await {
            logging!(error, Type::Config, "Failed to generate runtime config: {}", err);
        } else {
            logging!(info, Type::Config, "Runtime config generated successfully");
        }

        let config_result = Self::generate_file(ConfigType::Run).await;

        let validation_result = if config_result.is_ok() {
            logging!(info, Type::Config, "Validating runtime config");

            match CoreConfigValidator::global().validate_config().await {
                Ok((is_valid, error_msg)) => {
                    if !is_valid {
                        logging!(
                            warn,
                            Type::Config,
                            "Config validation failed at startup, falling back to default: {}",
                            error_msg
                        );
                        CoreManager::global()
                            .use_default_config("config_validate::boot_error", &error_msg)
                            .await?;
                        Some(("config_validate::boot_error", error_msg))
                    } else {
                        logging!(info, Type::Config, "Config validation succeeded");
                        None
                    }
                }
                Err(err) => {
                    logging!(warn, Type::Config, "Validation process failed: {}", err);
                    CoreManager::global()
                        .use_default_config("config_validate::process_terminated", "")
                        .await?;
                    Some(("config_validate::process_terminated", String::new()))
                }
            }
        } else {
            logging!(warn, Type::Config, "Failed to generate config file, using default");
            CoreManager::global()
                .use_default_config("config_validate::error", "")
                .await?;
            Some(("config_validate::error", String::new()))
        };

        if let Some((msg_type, msg_content)) = validation_result {
            sleep(timing::STARTUP_ERROR_DELAY).await;
            handle::Handle::notice_message(msg_type, &msg_content);
        }

        Ok(())
    }

    pub async fn generate_file(typ: ConfigType) -> Result<PathBuf> {
        let path = match typ {
            ConfigType::Run => dirs::app_home_dir()?.join(files::RUNTIME_CONFIG),
            ConfigType::Check => dirs::app_home_dir()?.join(files::CHECK_CONFIG),
        };

        let runtime = Config::runtime().await;
        let config = runtime
            .latest_ref()
            .config
            .as_ref()
            .ok_or(anyhow!("Runtime config not available"))?
            .clone();
        drop(runtime);

        help::save_yaml(&path, &config, Some("# Generated by Clash Verge")).await?;
        Ok(path)
    }

    pub async fn generate() -> Result<()> {
        let (config, exists_keys, logs) = enhance::enhance().await;

        *Config::runtime().await.draft_mut() = Box::new(IRuntime {
            config: Some(config),
            exists_keys,
            chain_logs: logs,
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
            if Config::runtime().await.latest_ref().config.is_some() {
                return Ok::<(), BackoffError<anyhow::Error>>(());
            }

            Config::generate().await.map_err(BackoffError::transient)
        };

        if let Err(e) = backoff::future::retry(backoff_strategy, operation).await {
            logging!(error, Type::Setup, "Config init verification failed: {}", e);
        }
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
        let merge_item =
            PrfItem::from_merge(Some("Merge".into())).expect("Failed to create merge item in test");
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
        let draft = Draft::from(IRuntime::new());
        let iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(iruntime_size, std::mem::size_of::<Draft<IRuntime>>());
    }

    #[test]
    #[allow(unused_variables)]
    fn test_draft_size_boxed() {
        let draft = Draft::from(Box::new(IRuntime::new()));
        let box_iruntime_size = std::mem::size_of_val(&draft);
        assert_eq!(
            box_iruntime_size,
            std::mem::size_of::<Draft<Box<IRuntime>>>()
        );
    }
}

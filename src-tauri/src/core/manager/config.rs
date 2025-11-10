use super::CoreManager;
use crate::{
    config::{Config, ConfigType, IRuntime},
    constants::timing,
    core::{handle, validate::CoreConfigValidator},
    logging,
    utils::{dirs, help, logging::Type},
};
use anyhow::{Result, anyhow};
use smartstring::alias::String;
use std::{path::PathBuf, time::Instant};
use tauri_plugin_mihomo::Error as MihomoError;
use tokio::time::sleep;

impl CoreManager {
    pub async fn use_default_config(&self, error_key: &str, error_msg: &str) -> Result<()> {
        use crate::constants::files::RUNTIME_CONFIG;

        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        let clash_config = &Config::clash().await.latest_arc().0;

        Config::runtime().await.edit_draft(|d| {
            *d = IRuntime {
                config: Some(clash_config.to_owned()),
                exists_keys: vec![],
                chain_logs: Default::default(),
            }
        });

        help::save_yaml(&runtime_path, &clash_config, Some("# Clash Verge Runtime")).await?;
        handle::Handle::notice_message(error_key, error_msg);
        Ok(())
    }

    pub async fn update_config(&self) -> Result<(bool, String)> {
        if handle::Handle::global().is_exiting() {
            return Ok((true, String::new()));
        }

        if !self.should_update_config()? {
            return Ok((true, String::new()));
        }

        self.perform_config_update().await
    }

    fn should_update_config(&self) -> Result<bool> {
        let now = Instant::now();
        let last = self.get_last_update();

        if let Some(last_time) = last
            && now.duration_since(*last_time) < timing::CONFIG_UPDATE_DEBOUNCE
        {
            return Ok(false);
        }

        self.set_last_update(now);
        Ok(true)
    }

    async fn perform_config_update(&self) -> Result<(bool, String)> {
        Config::generate().await?;

        match CoreConfigValidator::global().validate_config().await {
            Ok((true, _)) => {
                let run_path = Config::generate_file(ConfigType::Run).await?;
                self.apply_config(run_path).await?;
                Ok((true, String::new()))
            }
            Ok((false, error_msg)) => {
                Config::runtime().await.discard();
                Ok((false, error_msg))
            }
            Err(e) => {
                Config::runtime().await.discard();
                Err(e)
            }
        }
    }

    pub async fn put_configs_force(&self, path: PathBuf) -> Result<()> {
        self.apply_config(path).await
    }

    pub(super) async fn apply_config(&self, path: PathBuf) -> Result<()> {
        let path_str = dirs::path_to_str(&path)?;

        match self.reload_config(path_str).await {
            Ok(_) => {
                Config::runtime().await.apply();
                logging!(info, Type::Core, "Configuration applied");
                Ok(())
            }
            Err(err) if Self::should_restart_on_error(&err) => {
                self.retry_with_restart(path_str).await
            }
            Err(err) => {
                Config::runtime().await.discard();
                Err(anyhow!("Failed to apply config: {}", err))
            }
        }
    }

    async fn retry_with_restart(&self, config_path: &str) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Err(anyhow!("Application exiting"));
        }

        logging!(warn, Type::Core, "Restarting core for config reload");
        self.restart_core().await?;
        sleep(timing::CONFIG_RELOAD_DELAY).await;

        self.reload_config(config_path).await?;
        Config::runtime().await.apply();
        logging!(info, Type::Core, "Configuration applied after restart");
        Ok(())
    }

    async fn reload_config(&self, path: &str) -> Result<(), MihomoError> {
        handle::Handle::mihomo()
            .await
            .reload_config(true, path)
            .await
    }

    fn should_restart_on_error(err: &MihomoError) -> bool {
        match err {
            MihomoError::ConnectionFailed | MihomoError::ConnectionLost => true,
            MihomoError::Io(io_err) => Self::is_connection_io_error(io_err.kind()),
            MihomoError::Reqwest(req_err) => {
                req_err.is_connect()
                    || req_err.is_timeout()
                    || Self::contains_error_pattern(&req_err.to_string())
            }
            MihomoError::FailedResponse(msg) => Self::contains_error_pattern(msg),
            _ => false,
        }
    }

    const fn is_connection_io_error(kind: std::io::ErrorKind) -> bool {
        matches!(
            kind,
            std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::ConnectionRefused
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::NotFound
        )
    }

    fn contains_error_pattern(text: &str) -> bool {
        use crate::constants::error_patterns::CONNECTION_ERRORS;
        CONNECTION_ERRORS.iter().any(|p| text.contains(p))
    }
}

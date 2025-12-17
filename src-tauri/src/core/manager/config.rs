use super::CoreManager;
use crate::{
    config::{Config, ConfigType},
    constants::timing,
    core::{handle, validate::CoreConfigValidator},
    utils::{dirs, help},
};
use anyhow::{Result, anyhow};
use clash_verge_logging::{Type, logging};
use clash_verge_types::runtime::IRuntime;
use smartstring::alias::String;
use std::{collections::HashSet, path::PathBuf, time::Instant};
use tauri_plugin_mihomo::Error as MihomoError;

impl CoreManager {
    pub async fn use_default_config(&self, error_key: &str, error_msg: &str) -> Result<()> {
        use crate::constants::files::RUNTIME_CONFIG;

        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        let clash_config = &Config::clash().await.latest_arc().0;

        Config::runtime().await.edit_draft(|d| {
            *d = IRuntime {
                config: Some(clash_config.to_owned()),
                exists_keys: HashSet::new(),
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

        if !self.should_update_config() {
            return Ok((true, String::new()));
        }

        self.perform_config_update().await
    }

    fn should_update_config(&self) -> bool {
        let now = Instant::now();
        let last = self.get_last_update();

        if let Some(last_time) = last
            && now.duration_since(*last_time) < timing::CONFIG_UPDATE_DEBOUNCE
        {
            return false;
        }

        self.set_last_update(now);
        true
    }

    async fn perform_config_update(&self) -> Result<(bool, String)> {
        Config::generate().await?;
        self.apply_generate_confihg().await
    }

    pub async fn apply_generate_confihg(&self) -> Result<(bool, String)> {
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

    async fn apply_config(&self, path: PathBuf) -> Result<()> {
        let path = dirs::path_to_str(&path)?;
        match self.reload_config(path).await {
            Ok(_) => {
                Config::runtime().await.apply();
                logging!(info, Type::Core, "Configuration applied");
                Ok(())
            }
            Err(err) => {
                Config::runtime().await.discard();
                Err(anyhow!("Failed to apply config: {}", err))
            }
        }
    }

    async fn reload_config(&self, path: &str) -> Result<(), MihomoError> {
        handle::Handle::mihomo().await.reload_config(true, path).await
    }
}

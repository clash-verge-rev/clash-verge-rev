use super::{CoreManager, RunningMode};
use crate::{
    config::{Config, ConfigType, runtime::IRuntime},
    constants::timing,
    core::{
        handle,
        validate::{CoreConfigValidator, ValidationOutcome, ValidationSkipReason},
    },
    utils::{dirs, help},
};
use anyhow::{Result, anyhow};
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
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

    pub async fn update_config_forced(&self) -> Result<ValidationOutcome> {
        self.update_config_with_force(true).await
    }

    pub async fn update_config_with_force(&self, force: bool) -> Result<ValidationOutcome> {
        if handle::Handle::global().is_exiting() {
            return Ok(ValidationOutcome::Skipped {
                reason: ValidationSkipReason::Exiting,
            });
        }

        if !self.try_start_config_update() {
            logging!(info, Type::Core, "Configuration update is already running");
            return Ok(ValidationOutcome::Busy);
        }
        defer! {
            self.finish_config_update();
        }

        if !force && !self.should_update_config() {
            logging!(debug, Type::Core, "Skipping config update due to debounce");
            return Ok(ValidationOutcome::Skipped {
                reason: ValidationSkipReason::Debounced,
            });
        }

        if force {
            self.set_last_update(Instant::now());
        }

        self.perform_config_update().await
    }

    pub async fn update_config_checked(&self) -> Result<()> {
        let outcome = self.update_config_forced().await?;
        if outcome.is_valid() {
            Ok(())
        } else {
            Err(anyhow!("{outcome}"))
        }
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

    async fn perform_config_update(&self) -> Result<ValidationOutcome> {
        let runtime = Config::runtime().await;
        let transaction = DraftTransaction::new(vec![&runtime]);

        if let Err(err) = Config::generate().await {
            let message: String = err.to_string().into();
            return Ok(ValidationOutcome::invalid_from_message(message));
        }

        self.validate_and_apply(transaction).await
    }

    pub(crate) async fn update_runtime_config<F>(&self, f: F) -> Result<ValidationOutcome>
    where
        F: FnOnce(&mut IRuntime),
    {
        if !self.try_start_config_update() {
            logging!(info, Type::Core, "Configuration update is already running");
            return Ok(ValidationOutcome::Busy);
        }
        defer! {
            self.finish_config_update();
        }

        let runtime = Config::runtime().await;
        let transaction = DraftTransaction::new(vec![&runtime]);
        runtime.edit_draft(f);
        self.validate_and_apply(transaction).await
    }

    /// Validate the staged Runtime Config and hand it to the Core, committing only if both work.
    ///
    /// Takes the transaction rather than opening one, so it covers the staging its callers did.
    /// Every way out of here other than the last line rolls that staging back.
    async fn validate_and_apply(&self, transaction: DraftTransaction<'_>) -> Result<ValidationOutcome> {
        let outcome = CoreConfigValidator::global().validate_config_outcome().await?;
        if !outcome.is_valid() {
            return Ok(outcome);
        }

        let run_path = Config::generate_file(ConfigType::Run).await?;
        self.apply_config(run_path).await?;
        transaction.commit();
        Ok(ValidationOutcome::Valid)
    }

    /// Hand the generated configuration to the Core.
    ///
    /// Says nothing about drafts: whether the staged Runtime Config is kept follows from
    /// whether this succeeded, and the caller's transaction decides that.
    async fn apply_config(&self, path: PathBuf) -> Result<()> {
        if matches!(*self.get_running_mode(), RunningMode::Service) {
            let _lifecycle = self.lifecycle_lock.lock().await;
            if !matches!(*self.get_running_mode(), RunningMode::Service) {
                return Err(anyhow!("core mode changed while applying service configuration"));
            }
            self.replace_service_core_with_config(&path).await?;
            logging!(info, Type::Core, "Configuration materialized and applied by service");
            return Ok(());
        }

        let path = dirs::path_to_str(&path)?;
        let Err(err) = self.reload_config(path).await else {
            logging!(info, Type::Core, "Configuration applied");
            return Ok(());
        };

        logging!(
            warn,
            Type::Core,
            "Failed to apply configuration by mihomo api, restart core to apply it, error msg: {err}"
        );
        match self.restart_core().await {
            Ok(_) => {
                logging!(info, Type::Core, "Configuration applied after restart");
                Ok(())
            }
            Err(err) => {
                logging!(error, Type::Core, "Failed to restart core: {}", err);
                Err(anyhow!("Failed to apply config: {}", err))
            }
        }
    }

    async fn reload_config(&self, path: &str) -> Result<(), MihomoError> {
        handle::Handle::mihomo().await.reload_config(true, path).await
    }
}

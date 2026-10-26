use crate::{
    config::{
        Config, IClashTemp, IVerge,
        snapshot::{FileSnapshot, capture_config_files, restore_files},
    },
    core::{
        CoreManager,
        auto_backup::AutoBackupManager,
        manager::RunningMode,
        notify::{Refresh, announce},
        proxy_control::rollback_failure,
        validate::CoreConfigValidator,
    },
};
use anyhow::{Context as _, Result, ensure};
use clash_verge_draft::{Draft, DraftTransaction};
use clash_verge_logging::{Type, logging, logging_error};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Mapping;
use std::net::SocketAddr;

#[derive(Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalControllerSettings {
    pub enabled: bool,
    pub address: String,
    pub secret: String,
}

impl ExternalControllerSettings {
    fn from_config(clash: &IClashTemp, verge: &IVerge) -> Self {
        Self {
            enabled: verge.enable_external_controller.unwrap_or(false),
            address: clash.get_external_controller_address(),
            secret: clash.get_client_info().secret.unwrap_or_default(),
        }
    }

    fn clash_patch(&self) -> Result<Mapping> {
        let mut patch = Mapping::new();
        if self.enabled {
            let address = self.address.trim();
            ensure!(!address.is_empty(), "controller address cannot be empty");
            ensure!(!self.secret.trim().is_empty(), "controller secret cannot be empty");
            let address = if address.starts_with(':') {
                format!("127.0.0.1{address}")
            } else {
                address.to_owned()
            };
            let address: SocketAddr = address.parse().context("invalid external controller listen address")?;
            ensure!(address.port() != 0, "controller port cannot be zero");
            patch.insert("external-controller".into(), address.to_string().into());
            patch.insert("secret".into(), self.secret.clone().into());
        } else {
            patch.insert("external-controller".into(), "".into());
        }
        Ok(patch)
    }

    fn changes_config(&self, patch: &Mapping, clash: &IClashTemp, verge: &IVerge) -> bool {
        self.enabled != verge.enable_external_controller.unwrap_or(false)
            || patch.iter().any(|(key, value)| clash.0.get(key) != Some(value))
    }

    fn stage(&self, patch: &Mapping, clash: &Draft<IClashTemp>, verge: &Draft<IVerge>) {
        clash.edit_draft(|draft| draft.patch_config(patch));
        verge.edit_draft(|draft| draft.enable_external_controller = Some(self.enabled));
    }
}

pub async fn get_external_controller() -> ExternalControllerSettings {
    let _config_write = Config::lock_config_write().await;
    ExternalControllerSettings::from_config(&Config::clash().await.data_arc(), &Config::verge().await.data_arc())
}

pub async fn save_external_controller(settings: ExternalControllerSettings) -> Result<()> {
    let patch = settings.clash_patch()?;
    let config_write = Config::try_lock_config_write()?;
    let manager = CoreManager::global();
    let update = manager.claim_config_update(&config_write)?;

    let clash = Config::clash().await;
    let verge = Config::verge().await;
    if !settings.changes_config(&patch, &clash.data_arc(), &verge.data_arc()) {
        return Ok(());
    }

    let runtime = Config::runtime().await;
    let previous_runtime = runtime.data_arc().config.clone();
    let transaction = DraftTransaction::begin(vec![&clash, &verge, &runtime])?;
    settings.stage(&patch, &clash, &verge);
    Config::generate().await?;

    let yaml = Config::runtime_config_yaml().await?;
    let validation = CoreConfigValidator::global()
        .validate_config_outcome_with(&yaml)
        .await?;
    ensure!(
        validation.is_valid(),
        "external controller configuration is invalid: {validation}"
    );

    let snapshots = capture_config_files().await?;
    // Persist before replacing the core, so a write failure leaves the running core untouched.
    let persist_result = async {
        Config::write_runtime_file(&yaml).await?;
        clash.latest_arc().save_config().await?;
        verge.latest_arc().save_file().await
    }
    .await;
    if let Err(error) = persist_result {
        transaction.rollback();
        return match restore_files(&snapshots).await {
            Ok(()) => Err(error).context("failed to persist external controller settings"),
            Err(rollback_error) => Err(rollback_failure(error, rollback_error)),
        };
    }

    let previous_mode = *manager.get_running_mode();
    if !matches!(previous_mode, RunningMode::NotRunning)
        && previous_runtime != runtime.latest_arc().config
        && let Err(error) = manager.restart_core_during_config_update().await
    {
        transaction.rollback();
        return match restore_external_controller(&snapshots, previous_mode).await {
            Ok(()) => Err(error).context("failed to activate external controller settings"),
            Err(rollback_error) => Err(rollback_failure(error, rollback_error)),
        };
    }

    transaction.commit();
    announce(Refresh::Clash);
    announce(Refresh::Verge);
    logging_error!(Type::Backup, AutoBackupManager::global().refresh_settings().await);
    logging!(info, Type::Config, "External controller settings applied and persisted");
    drop(update);
    drop(config_write);
    Ok(())
}

async fn restore_external_controller(snapshots: &[FileSnapshot], previous_mode: RunningMode) -> Result<()> {
    let file_result = restore_files(snapshots).await;
    if file_result.is_err() {
        let _ = Config::generate_file().await;
    }
    if matches!(previous_mode, RunningMode::Service) {
        // A rejected start marks the service unavailable even when the helper is still healthy.
        crate::core::runstate::RUN_STATE.observe_current_health().await;
    }
    let manager = CoreManager::global();
    let core_result = if matches!(*manager.get_running_mode(), RunningMode::NotRunning) {
        manager.start_core_during_config_update().await
    } else {
        manager.restart_core_during_config_update().await
    };
    match (file_result, core_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
        (Err(file_error), Err(core_error)) => {
            Err(core_error.context(format!("failed to restore configuration files: {file_error:#}")))
        }
    }
}


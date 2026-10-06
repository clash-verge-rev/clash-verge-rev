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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::runtime::IRuntime;

    fn settings(address: &str, secret: &str) -> ExternalControllerSettings {
        ExternalControllerSettings {
            enabled: true,
            address: address.into(),
            secret: secret.into(),
        }
    }

    #[test]
    fn rejects_invalid_enabled_settings_before_staging() {
        for (address, secret) in [
            ("", "secret"),
            (" ", "secret"),
            ("127.0.0.1:9097", " "),
            ("localhost:9097", "secret"),
            ("127.0.0.1:65536", "secret"),
            ("127.0.0.1:0", "secret"),
        ] {
            assert!(
                settings(address, secret).clash_patch().is_err(),
                "accepted invalid address or secret"
            );
        }
    }

    #[test]
    fn normalizes_listen_addresses_without_rewriting_wildcards_or_secrets() -> Result<()> {
        for (input, expected) in [
            (" 0.0.0.0:9097 ", "0.0.0.0:9097"),
            ("[::]:9097", "[::]:9097"),
            (":9097", "127.0.0.1:9097"),
        ] {
            let patch = settings(input, " secret ").clash_patch()?;
            assert_eq!(
                patch.get("external-controller").and_then(|v| v.as_str()),
                Some(expected)
            );
            assert_eq!(patch.get("secret").and_then(|v| v.as_str()), Some(" secret "));
        }
        Ok(())
    }

    #[test]
    fn reads_the_listen_address_instead_of_the_client_address() {
        let mut clash = IClashTemp::template();
        clash.0.insert("external-controller".into(), "0.0.0.0:9097".into());
        assert_eq!(
            ExternalControllerSettings::from_config(&clash, &IVerge::default()).address,
            "0.0.0.0:9097"
        );
    }

    #[test]
    fn disabled_saves_leave_the_secret_and_cors_untouched_and_become_noops() -> Result<()> {
        let mut clash = IClashTemp::template();
        let cors = clash.0.get("external-controller-cors").cloned();
        let secret = clash.0.get("secret").cloned();
        let mut disabled = settings("invalid", "");
        disabled.enabled = false;
        let patch = disabled.clash_patch()?;
        clash.patch_config(&patch);
        assert_eq!(clash.0.get("secret"), secret.as_ref());
        assert_eq!(clash.0.get("external-controller-cors"), cors.as_ref());
        assert!(!disabled.changes_config(&patch, &clash, &IVerge::default()));
        Ok(())
    }

    #[test]
    fn stages_controller_settings_and_rolls_back_all_three_layers() -> Result<()> {
        let clash = Draft::new(IClashTemp::template());
        let verge = Draft::new(IVerge::default());
        let runtime = Draft::new(IRuntime::default());
        let original = clash.data_arc().0.clone();
        let requested = settings("127.0.0.1:39097", "new-secret");
        let patch = requested.clash_patch()?;
        let transaction = DraftTransaction::begin(vec![&clash, &verge, &runtime])?;
        requested.stage(&patch, &clash, &verge);
        runtime.edit_draft(|draft| draft.config = Some(Mapping::new()));
        assert_eq!(verge.latest_arc().enable_external_controller, Some(true));
        assert_eq!(
            clash.latest_arc().0.get("secret").and_then(|v| v.as_str()),
            Some("new-secret")
        );
        transaction.rollback();
        assert_eq!(clash.latest_arc().0, original);
        assert_eq!(verge.latest_arc().enable_external_controller, None);
        assert!(runtime.latest_arc().config.is_none());
        Ok(())
    }

    #[test]
    fn committed_enabled_settings_are_noops_on_the_next_save() -> Result<()> {
        let clash = Draft::new(IClashTemp::template());
        let verge = Draft::new(IVerge::default());
        let requested = settings("127.0.0.1:39097", "new-secret");
        let patch = requested.clash_patch()?;
        let transaction = DraftTransaction::begin(vec![&clash, &verge])?;
        requested.stage(&patch, &clash, &verge);
        transaction.commit();
        assert!(!requested.changes_config(&patch, &clash.data_arc(), &verge.data_arc()));
        Ok(())
    }
}

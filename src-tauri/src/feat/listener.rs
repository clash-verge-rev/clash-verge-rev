use crate::{
    config::{
        Config, ConfigType,
        snapshot::{FileSnapshot, capture_config_files, restore_files},
    },
    core::{
        CoreManager,
        handle::Handle,
        listener::{
            ListenerProbe, ListenerProbeOutcome, ProxyPortSettings, SaveProxyPortsOutcome,
            probe_listener as probe_listener_sync, probe_proxy_port_change,
        },
        manager::RunningMode,
        validate::CoreConfigValidator,
    },
    process::AsyncHandler,
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging};
use scopeguard::defer;

pub async fn probe_listener(request: ListenerProbe) -> Result<ListenerProbeOutcome> {
    AsyncHandler::spawn_blocking(move || probe_listener_sync(&request))
        .await
        .context("listener probe task failed")
}

#[allow(clippy::cognitive_complexity)]
pub async fn save_proxy_ports(settings: ProxyPortSettings) -> Result<SaveProxyPortsOutcome> {
    settings.validate()?;
    let manager = CoreManager::global();
    if !manager.try_start_config_update() {
        bail!("configuration update is already running");
    }
    defer! {
        manager.finish_config_update();
    }

    let current = current_runtime_mapping().await?;
    stage_proxy_ports(&settings).await;
    if let Err(error) = Config::generate().await {
        discard_proxy_port_drafts().await;
        return Err(error).context("failed to generate candidate proxy port configuration");
    }
    let candidate = match latest_runtime_mapping().await {
        Ok(candidate) => candidate,
        Err(error) => {
            discard_proxy_port_drafts().await;
            return Err(error);
        }
    };
    let was_running = !matches!(*manager.get_running_mode(), RunningMode::NotRunning);
    let assessment = match probe_proxy_ports(current.clone(), candidate.clone(), was_running).await {
        Ok(assessment) => assessment,
        Err(error) => {
            discard_proxy_port_drafts().await;
            return Err(error);
        }
    };
    match rejected_save_outcome(assessment) {
        Ok(Some(outcome)) => {
            discard_proxy_port_drafts().await;
            return Ok(outcome);
        }
        Ok(None) => {}
        Err(error) => {
            discard_proxy_port_drafts().await;
            return Err(error);
        }
    }

    let validation = match CoreConfigValidator::global().validate_config_outcome().await {
        Ok(validation) => validation,
        Err(error) => {
            discard_proxy_port_drafts().await;
            return Err(error).context("failed to validate candidate proxy port configuration");
        }
    };
    if !validation.is_valid() {
        discard_proxy_port_drafts().await;
        bail!("candidate proxy port configuration is invalid: {validation}");
    }

    let snapshots = match capture_config_files().await {
        Ok(snapshots) => snapshots,
        Err(error) => {
            discard_proxy_port_drafts().await;
            return Err(error);
        }
    };
    if let Err(error) = Config::generate_file(ConfigType::Run).await {
        discard_proxy_port_drafts().await;
        return match restore_files(&snapshots).await {
            Ok(()) => Err(error).context("failed to persist candidate Runtime Configuration"),
            Err(rollback_error) => Err(anyhow!("{error:#}; configuration rollback failed: {rollback_error:#}")),
        };
    }

    if was_running && let Err(activation_error) = manager.restart_core().await {
        if let Err(rollback_error) = rollback_proxy_ports(&snapshots, was_running).await {
            return Err(anyhow!(
                "failed to activate proxy port configuration: {activation_error:#}; \
                 configuration rollback failed: {rollback_error:#}"
            ));
        }

        let post_failure_assessment = probe_proxy_ports(current, candidate, was_running).await?;
        if let Some(outcome) = rejected_save_outcome(post_failure_assessment)? {
            logging!(
                warn,
                Type::Config,
                "Proxy port became unavailable while Mihomo was restarting: {activation_error:#}"
            );
            return Ok(outcome);
        }
        return Err(activation_error).context("Mihomo rejected the proxy port configuration");
    }

    if let Err(persist_error) = persist_proxy_port_sources().await {
        return match rollback_proxy_ports(&snapshots, was_running).await {
            Ok(()) => Err(persist_error),
            Err(rollback_error) => Err(anyhow!(
                "{persist_error:#}; configuration rollback failed: {rollback_error:#}"
            )),
        };
    }

    Config::clash().await.apply();
    Config::verge().await.apply();
    Config::runtime().await.apply();
    Handle::refresh_clash();
    Handle::refresh_verge();
    logging!(info, Type::Config, "Proxy port configuration applied and persisted");
    Ok(SaveProxyPortsOutcome::Saved)
}

async fn current_runtime_mapping() -> Result<serde_yaml_ng::Mapping> {
    Config::runtime()
        .await
        .data_arc()
        .config
        .clone()
        .ok_or_else(|| anyhow!("current Runtime Configuration is unavailable"))
}

async fn latest_runtime_mapping() -> Result<serde_yaml_ng::Mapping> {
    Config::runtime()
        .await
        .latest_arc()
        .config
        .clone()
        .ok_or_else(|| anyhow!("candidate Runtime Configuration is unavailable"))
}

async fn probe_proxy_ports(
    current: serde_yaml_ng::Mapping,
    candidate: serde_yaml_ng::Mapping,
    current_core_is_running: bool,
) -> Result<ListenerProbeOutcome> {
    AsyncHandler::spawn_blocking(move || probe_proxy_port_change(&current, &candidate, current_core_is_running))
        .await
        .context("proxy port probe task failed")
}

fn rejected_save_outcome(assessment: ListenerProbeOutcome) -> Result<Option<SaveProxyPortsOutcome>> {
    match assessment {
        ListenerProbeOutcome::Available => Ok(None),
        ListenerProbeOutcome::Conflict { port, transport } => {
            Ok(Some(SaveProxyPortsOutcome::Conflict { port, transport }))
        }
        ListenerProbeOutcome::Invalid { message } => bail!("{message}"),
        ListenerProbeOutcome::Indeterminate { message } => bail!("{message}"),
    }
}

async fn stage_proxy_ports(settings: &ProxyPortSettings) {
    Config::clash().await.edit_draft(|draft| {
        draft.0.insert("mixed-port".into(), settings.mixed_port.into());
        draft.0.insert("socks-port".into(), settings.socks.port.into());
        draft.0.insert("port".into(), settings.http.port.into());
        #[cfg(not(target_os = "windows"))]
        draft.0.insert("redir-port".into(), settings.redir.port.into());
        #[cfg(target_os = "linux")]
        draft.0.insert("tproxy-port".into(), settings.tproxy.port.into());
    });
    Config::verge().await.edit_draft(|draft| {
        draft.verge_mixed_port = Some(settings.mixed_port);
        draft.verge_socks_port = Some(settings.socks.port);
        draft.verge_socks_enabled = Some(settings.socks.enabled);
        draft.verge_port = Some(settings.http.port);
        draft.verge_http_enabled = Some(settings.http.enabled);
        #[cfg(not(target_os = "windows"))]
        {
            draft.verge_redir_port = Some(settings.redir.port);
            draft.verge_redir_enabled = Some(settings.redir.enabled);
        }
        #[cfg(target_os = "linux")]
        {
            draft.verge_tproxy_port = Some(settings.tproxy.port);
            draft.verge_tproxy_enabled = Some(settings.tproxy.enabled);
        }
    });
}

async fn persist_proxy_port_sources() -> Result<()> {
    Config::clash()
        .await
        .latest_arc()
        .save_config()
        .await
        .context("failed to persist Application Merge Configuration")?;
    Config::verge()
        .await
        .latest_arc()
        .save_file()
        .await
        .context("failed to persist selected proxy ports")?;
    Ok(())
}

async fn discard_proxy_port_drafts() {
    Config::clash().await.discard();
    Config::verge().await.discard();
    Config::runtime().await.discard();
}

async fn rollback_proxy_ports(snapshots: &[FileSnapshot], was_running: bool) -> Result<()> {
    discard_proxy_port_drafts().await;
    let file_result = restore_files(snapshots).await;
    if file_result.is_err() {
        let _ = Config::generate_file(ConfigType::Run).await;
    }

    let lifecycle_result = if was_running {
        let manager = CoreManager::global();
        if matches!(*manager.get_running_mode(), RunningMode::NotRunning) {
            manager.start_core().await
        } else {
            manager.restart_core().await
        }
    } else {
        Ok(())
    };

    match (file_result, lifecycle_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(file_error), Ok(())) => Err(file_error),
        (Ok(()), Err(lifecycle_error)) => Err(lifecycle_error).context("failed to restore the previous core"),
        (Err(file_error), Err(lifecycle_error)) => Err(anyhow!(
            "failed to restore configuration files: {file_error:#}; \
             failed to restore the previous core: {lifecycle_error:#}"
        )),
    }
}

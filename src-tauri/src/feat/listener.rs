use crate::{
    config::{
        Config, ConfigType, MixedPort,
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
        proxy_control::rollback_failure,
        validate::CoreConfigValidator,
    },
    process::AsyncHandler,
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_draft::DraftTransaction;
use clash_verge_logging::{Type, logging};
use scopeguard::{ScopeGuard, defer, guard};

pub async fn probe_listener(request: ListenerProbe) -> Result<ListenerProbeOutcome> {
    AsyncHandler::spawn_blocking(move || probe_listener_sync(&request))
        .await
        .context("listener probe task failed")
}

#[allow(clippy::cognitive_complexity)]
pub async fn save_proxy_ports(settings: ProxyPortSettings) -> Result<SaveProxyPortsOutcome> {
    settings.validate()?;
    let _config_write = Config::lock_config_write().await;
    let manager = CoreManager::global();
    if !manager.try_start_config_update() {
        bail!("configuration update is already running");
    }
    defer! {
        manager.finish_config_update();
    }

    // Read first because transaction rollback discards all claimed drafts.
    let current = current_runtime_mapping().await?;

    let clash = Config::clash().await;
    let verge = Config::verge().await;
    let runtime = Config::runtime().await;
    // Roll back all three drafts if the candidate is rejected or fails.
    let transaction = DraftTransaction::begin(vec![&clash, &verge, &runtime])?;

    stage_proxy_ports(&settings).await;
    // Hide PAC while the staged ports are not yet serving traffic.
    manager.core_starting();
    // Recompute PAC state after every exit path.
    defer! {
        manager.core_start_settled();
    }
    // A user-picked port ends the startup fallback, but only once the save lands: until then the
    // Core still serves the borrowed port, so every failing exit must put it back or the system
    // proxy and PAC point at a dead port. Declared after the PAC guard so it restores first.
    let borrowed_port = guard(MixedPort::session_fallback(), restore_borrowed_port);
    MixedPort::clear_session_fallback();
    Config::generate()
        .await
        .context("failed to generate candidate proxy port configuration")?;
    let candidate = latest_runtime_mapping().await?;

    let was_running = !matches!(*manager.get_running_mode(), RunningMode::NotRunning);
    let assessment = probe_proxy_ports(current.clone(), candidate.clone(), was_running).await?;
    if let Some(outcome) = rejected_save_outcome(assessment)? {
        return Ok(outcome);
    }

    let validation = CoreConfigValidator::global()
        .validate_config_outcome()
        .await
        .context("failed to validate candidate proxy port configuration")?;
    if !validation.is_valid() {
        bail!("candidate proxy port configuration is invalid: {validation}");
    }

    let snapshots = capture_config_files().await?;
    // Once files change, failures must restore both files and drafts.
    if let Err(error) = Config::generate_file(ConfigType::Run).await {
        transaction.rollback();
        return match restore_files(&snapshots).await {
            Ok(()) => Err(error).context("failed to persist candidate Runtime Configuration"),
            Err(rollback_error) => Err(rollback_failure(error, rollback_error)),
        };
    }

    if was_running && let Err(activation_error) = manager.restart_core_during_config_update().await {
        transaction.rollback();
        // Ahead of the rollback, not on scope exit: restarting the old core re-applies the system
        // proxy from `MixedPort::desired()`, which must already name the borrowed port.
        restore_borrowed_port(*borrowed_port);
        if let Err(rollback_error) = rollback_proxy_ports(&snapshots, was_running).await {
            return Err(rollback_failure(activation_error, rollback_error)
                .context("failed to activate the proxy port configuration"));
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
        transaction.rollback();
        restore_borrowed_port(*borrowed_port);
        return match rollback_proxy_ports(&snapshots, was_running).await {
            Ok(()) => Err(persist_error),
            Err(rollback_error) => Err(rollback_failure(persist_error, rollback_error)),
        };
    }

    transaction.commit();
    // The save landed, so the port the app had borrowed is now irrelevant.
    let _ = ScopeGuard::into_inner(borrowed_port);
    Handle::refresh_clash();
    Handle::refresh_verge();
    logging!(info, Type::Config, "Proxy port configuration applied and persisted");
    Ok(SaveProxyPortsOutcome::Saved)
}

/// Put back the port a startup fallback had borrowed, after a save failed to replace it.
fn restore_borrowed_port(previous: Option<u16>) {
    match previous {
        Some(port) => MixedPort::set_session_fallback(port),
        None => MixedPort::clear_session_fallback(),
    }
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

/// Discard candidate drafts before restoring files from committed configuration.
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
            manager.start_core_during_config_update().await
        } else {
            manager.restart_core_during_config_update().await
        }
    } else {
        Ok(())
    };

    match (file_result, lifecycle_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(file_error), Ok(())) => Err(file_error),
        (Ok(()), Err(lifecycle_error)) => Err(lifecycle_error).context("failed to restore the previous core"),
        (Err(file_error), Err(lifecycle_error)) => Err(lifecycle_error
            .context(format!("failed to restore configuration files: {file_error:#}"))
            .context("failed to restore the previous core")),
    }
}

use super::{
    Config, ConfigType, IClashTemp, IVerge,
    snapshot::{capture_config_files, restore_files},
};
use crate::{
    constants::timing,
    core::{
        handle::Handle,
        listener::ListenerBindScope,
        owner_identity::current_owner_credentials,
        service::{SERVICE_MANAGER, ServiceStatus},
        validate::CoreConfigValidator,
    },
    process::AsyncHandler,
    utils::port::find_next_available_port,
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_yaml_ng::Value;
use std::{
    collections::HashSet,
    net::SocketAddr,
    str::FromStr as _,
    sync::atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Copy)]
struct MixedPortFallback {
    original: u16,
    current: u16,
}

static PENDING_FALLBACK_NOTICE: Lazy<Mutex<Option<MixedPortFallback>>> = Lazy::new(|| Mutex::new(None));
static STARTUP_CORE_BLOCKED: AtomicBool = AtomicBool::new(false);
static STARTUP_CORE_BLOCK_REASON: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

impl Config {
    pub(crate) async fn resolve_startup_mixed_port() -> Result<bool> {
        Self::resolve_startup_mixed_port_inner().await
    }

    pub(crate) async fn retry_startup_mixed_port_fallback() -> Result<bool> {
        Self::resolve_startup_mixed_port_inner().await
    }

    async fn resolve_startup_mixed_port_inner() -> Result<bool> {
        let clash = Self::clash().await.latest_arc();
        let verge = Self::verge().await.latest_arc();
        let selected_port = clash.get_mixed_port();
        let bind_scope =
            ListenerBindScope::from_mapping(&clash.0).context("failed to derive mixed proxy listener scope")?;

        if owned_service_core_uses_port(selected_port).await {
            logging!(
                info,
                Type::Setup,
                "Mixed proxy port {} belongs to the current user's managed core; skipping fallback",
                selected_port
            );
            return Ok(false);
        }

        let selected_scope = bind_scope.clone();
        let port_in_use = AsyncHandler::spawn_blocking(move || !selected_scope.mixed_port_is_available(selected_port))
            .await
            .context("mixed proxy port probe task failed")?;
        if !port_in_use {
            return Ok(false);
        }

        let reserved = configured_listener_ports(&clash, &verge);
        let candidate = AsyncHandler::spawn_blocking(move || {
            find_next_available_port(selected_port, &reserved, |port| {
                bind_scope.mixed_port_is_available(port)
            })
        })
        .await
        .context("mixed proxy fallback scan task failed")?
        .ok_or_else(|| anyhow!("no eligible mixed proxy port is available"))?;

        Self::apply_startup_mixed_port_fallback(selected_port, candidate).await?;
        Ok(true)
    }

    async fn apply_startup_mixed_port_fallback(old_port: u16, new_port: u16) -> Result<()> {
        let clash = Self::clash().await;
        let verge = Self::verge().await;
        let runtime = Self::runtime().await;

        clash.edit_draft(|draft| {
            draft.0.insert("mixed-port".into(), new_port.into());
        });
        verge.edit_draft(|draft| {
            draft.verge_mixed_port = Some(new_port);
        });

        if let Err(error) = Self::generate().await {
            clash.discard();
            verge.discard();
            runtime.discard();
            return Err(error).context("failed to materialize runtime configuration with fallback port");
        }

        let validation = match CoreConfigValidator::global().validate_config_outcome().await {
            Ok(outcome) => outcome,
            Err(error) => {
                clash.discard();
                verge.discard();
                runtime.discard();
                return Err(error).context("failed to validate runtime configuration with fallback port");
            }
        };
        if !validation.is_valid() {
            clash.discard();
            verge.discard();
            runtime.discard();
            bail!("runtime configuration with fallback port is invalid: {validation}");
        }

        let snapshots = match capture_config_files().await {
            Ok(snapshots) => snapshots,
            Err(error) => {
                clash.discard();
                verge.discard();
                runtime.discard();
                return Err(error);
            }
        };
        let candidate_clash = clash.latest_arc();
        let candidate_verge = verge.latest_arc();

        let persist_result = async {
            candidate_clash
                .save_config()
                .await
                .context("failed to persist Application Merge Configuration")?;
            candidate_verge
                .save_file()
                .await
                .context("failed to persist selected mixed proxy port")?;
            Self::generate_file(ConfigType::Run)
                .await
                .context("failed to persist Runtime Configuration")?;
            Ok::<(), anyhow::Error>(())
        }
        .await;

        if let Err(error) = persist_result {
            clash.discard();
            verge.discard();
            runtime.discard();
            return match restore_files(&snapshots).await {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(anyhow!("{error:#}; configuration rollback failed: {rollback_error:#}")),
            };
        }

        clash.apply();
        verge.apply();
        runtime.apply();
        record_fallback(old_port, new_port);
        Handle::refresh_clash();
        Handle::refresh_verge();
        logging!(
            warn,
            Type::Config,
            "Mixed proxy port {} is externally occupied; switched to {} and persisted all configuration layers",
            old_port,
            new_port
        );
        Ok(())
    }

    pub(crate) fn block_startup_core(error: &anyhow::Error) {
        STARTUP_CORE_BLOCKED.store(true, Ordering::Release);
        *STARTUP_CORE_BLOCK_REASON.lock() = Some(error.to_string());
        report_fallback_error(error.to_string());
    }

    pub(crate) fn startup_core_block_reason() -> Option<String> {
        if STARTUP_CORE_BLOCKED.load(Ordering::Acquire) {
            STARTUP_CORE_BLOCK_REASON.lock().clone()
        } else {
            None
        }
    }

    pub(crate) fn notify_startup_mixed_port_fallback() {
        let Some(change) = PENDING_FALLBACK_NOTICE.lock().take() else {
            return;
        };
        AsyncHandler::spawn(move || async move {
            tokio::time::sleep(timing::STARTUP_ERROR_DELAY).await;
            Handle::notice_message(
                "mixed_port::fallback",
                format!("{},{}", change.original, change.current),
            );
        });
    }
}

fn record_fallback(old_port: u16, new_port: u16) {
    let mut pending = PENDING_FALLBACK_NOTICE.lock();
    match pending.as_mut() {
        Some(change) => change.current = new_port,
        None => {
            *pending = Some(MixedPortFallback {
                original: old_port,
                current: new_port,
            });
        }
    }
}

fn report_fallback_error(message: String) {
    logging!(
        error,
        Type::Config,
        "Automatic mixed proxy port fallback failed: {}",
        message
    );
    AsyncHandler::spawn(move || async move {
        tokio::time::sleep(timing::STARTUP_ERROR_DELAY).await;
        Handle::notice_message("mixed_port::fallback_error", message);
    });
}

// Only service-managed cores can survive into this startup phase; this app has not spawned its sidecar yet.
async fn owned_service_core_uses_port(port: u16) -> bool {
    if !matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
        return false;
    }

    let credentials = match current_owner_credentials() {
        Ok(credentials) => credentials,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Unable to identify current service owner while checking mixed proxy port: {error:#}"
            );
            return false;
        }
    };
    let response = match clash_verge_service_ipc::get_status(&credentials).await {
        Ok(response) => response,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Unable to query current service owner while checking mixed proxy port: {error:#}"
            );
            return false;
        }
    };
    let Some(status) = response.data else {
        return false;
    };
    if response.code > 0 || !status.is_active || status.core_pid.is_none() {
        return false;
    }

    match Handle::mihomo().get_base_config().await {
        Ok(config) => config.mixed_port == port,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Current user's service core is active but its mixed proxy port is unavailable: {error}; \
                 preserving the selected port until core replacement resolves ownership"
            );
            true
        }
    }
}

fn configured_listener_ports(clash: &IClashTemp, verge: &IVerge) -> HashSet<u16> {
    let mut ports = HashSet::new();
    for key in ["socks-port", "port", "redir-port", "tproxy-port"] {
        if let Some(port) = mapping_port(&clash.0, key) {
            ports.insert(port);
        }
    }

    if let Ok(controller) = SocketAddr::from_str(IClashTemp::guard_external_controller(&clash.0).as_str()) {
        ports.insert(controller.port());
    }

    ports.extend([verge.verge_socks_port, verge.verge_port].into_iter().flatten());
    #[cfg(not(target_os = "windows"))]
    if let Some(port) = verge.verge_redir_port {
        ports.insert(port);
    }
    #[cfg(target_os = "linux")]
    if let Some(port) = verge.verge_tproxy_port {
        ports.insert(port);
    }
    ports
}

fn mapping_port(mapping: &serde_yaml_ng::Mapping, key: &str) -> Option<u16> {
    mapping.get(key).and_then(|value| match value {
        Value::String(port) => port.parse().ok(),
        Value::Number(port) => port.as_u64().and_then(|port| u16::try_from(port).ok()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::configured_listener_ports;
    use crate::config::{IClashTemp, IVerge};

    #[test]
    fn configured_ports_include_disabled_listener_assignments() {
        let ports = configured_listener_ports(&IClashTemp::template(), &IVerge::template());
        assert!(ports.contains(&7898));
        assert!(ports.contains(&7899));
        assert!(ports.contains(&9097));
        #[cfg(not(target_os = "windows"))]
        assert!(ports.contains(&7895));
        #[cfg(target_os = "linux")]
        assert!(ports.contains(&7896));
    }
}

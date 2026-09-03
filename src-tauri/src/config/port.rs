use super::{Config, ConfigType, IClashTemp, IVerge, MixedPort};
use crate::{
    constants::timing,
    core::{
        handle::Handle,
        listener::{ListenerBindScope, ListenerProbeOutcome, MIXED_PORT_KEY, proxy_listener_keys},
        owner_identity::current_owner_credentials,
        service::{SERVICE_MANAGER, ServiceStatus},
        validate::CoreConfigValidator,
    },
    process::AsyncHandler,
    utils::port::find_next_available_port,
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_draft::DraftTransaction;
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
        let _config_write = Self::lock_config_write().await;
        let clash = Self::clash().await.latest_arc();
        let verge = Self::verge().await.latest_arc();
        // A retry must re-examine the port this session actually tried, not the one still named
        // on disk, or it keeps picking the same replacement instead of walking past it.
        let selected_port = MixedPort::session_fallback().unwrap_or_else(|| clash.get_mixed_port());
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
        let outcome = AsyncHandler::spawn_blocking(move || selected_scope.probe_mixed_port(selected_port))
            .await
            .context("mixed proxy port probe task failed")?;
        // Only a proven conflict may move the port; an answer the probe could not reach is not
        // evidence. A `Conflict` here also means the probe confirmed something is serving.
        match outcome {
            ListenerProbeOutcome::Conflict { .. } => {}
            ListenerProbeOutcome::Available => return Ok(false),
            ListenerProbeOutcome::Invalid { message } | ListenerProbeOutcome::Indeterminate { message } => {
                logging!(
                    warn,
                    Type::Setup,
                    "Could not establish whether mixed proxy port {} is free ({}); keeping it",
                    selected_port,
                    message
                );
                return Ok(false);
            }
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

    /// Move this session onto `new_port` without touching what is on disk.
    ///
    /// Only the Runtime Configuration changes — the Core is its only reader and it is rebuilt
    /// every launch. `config.yaml` and `verge.yaml` keep naming `old_port` so the next launch
    /// asks for it again.
    async fn apply_startup_mixed_port_fallback(old_port: u16, new_port: u16) -> Result<()> {
        let runtime = Self::runtime().await;
        let transaction = DraftTransaction::begin(vec![&runtime])?;

        // On a later hop the uncommitted transaction restores the Runtime Config to the previous
        // hop, so restore the override to match rather than dropping to what is on disk.
        let previous_port = MixedPort::session_fallback();
        MixedPort::set_session_fallback(new_port);
        if let Err(error) = Self::stage_fallback_runtime().await {
            match previous_port {
                Some(port) => MixedPort::set_session_fallback(port),
                None => MixedPort::clear_session_fallback(),
            }
            return Err(error);
        }

        transaction.commit();
        record_fallback(old_port, new_port);
        Handle::refresh_clash();
        logging!(
            warn,
            Type::Config,
            "Mixed proxy port {} is externally occupied; serving on {} for this session only",
            old_port,
            new_port
        );
        Ok(())
    }

    async fn stage_fallback_runtime() -> Result<()> {
        Self::generate()
            .await
            .context("failed to materialize runtime configuration with fallback port")?;

        let validation = CoreConfigValidator::global()
            .validate_config_outcome()
            .await
            .context("failed to validate runtime configuration with fallback port")?;
        if !validation.is_valid() {
            bail!("runtime configuration with fallback port is invalid: {validation}");
        }

        Self::generate_file(ConfigType::Run)
            .await
            .context("failed to write Runtime Configuration")?;
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

// Only a service-managed core can still be running during startup. Every exit here decides
// whether the app may renumber a port the user chose, so each one logs why.
async fn owned_service_core_uses_port(port: u16) -> bool {
    let service_status = SERVICE_MANAGER.current().await;
    if !matches!(service_status, ServiceStatus::Ready) {
        logging!(
            info,
            Type::Service,
            "Service is {service_status:?}, so no managed core can hold mixed proxy port {port}"
        );
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
        logging!(
            warn,
            Type::Service,
            "Service returned no status while checking mixed proxy port {port}"
        );
        return false;
    };
    if response.code > 0 || !status.is_active || status.core_pid.is_none() {
        // Normal after a clean quit: the service drops the owner session and forgets the core, so
        // it can no longer vouch for whatever holds the port. This guard only covers dirty exits.
        logging!(
            info,
            Type::Service,
            "Service no longer tracks a core for this owner (code {}, active {}, pid {:?}); \
             mixed proxy port {} is unattributed",
            response.code,
            status.is_active,
            status.core_pid,
            port
        );
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
    // Exclude the Mixed Port because it is being reassigned.
    for key in proxy_listener_keys().filter(|key| *key != MIXED_PORT_KEY) {
        if let Some(port) = mapping_port(&clash.0, key) {
            ports.insert(port);
        }
    }

    if let Ok(controller) = SocketAddr::from_str(IClashTemp::guard_server_ctrl(&clash.0).as_str()) {
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
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod listener_key_tests {
    use super::{MIXED_PORT_KEY, proxy_listener_keys};

    #[test]
    fn the_reserved_set_covers_every_listener_but_the_one_being_moved() {
        let reserved: Vec<_> = proxy_listener_keys().filter(|key| *key != MIXED_PORT_KEY).collect();

        assert!(
            !reserved.contains(&MIXED_PORT_KEY),
            "the port being reassigned must not reserve itself"
        );
        assert_eq!(
            reserved.len(),
            proxy_listener_keys().count() - 1,
            "every other listener must be reserved, so a new one cannot be forgotten here"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::configured_listener_ports;
    use crate::config::{IClashTemp, IVerge};

    #[test]
    fn configured_ports_include_disabled_listener_assignments() {
        let ports = configured_listener_ports(&IClashTemp::default(), &IVerge::template());
        assert!(ports.contains(&7898));
        assert!(ports.contains(&7899));
        assert!(ports.contains(&9097));
        #[cfg(not(target_os = "windows"))]
        assert!(ports.contains(&7895));
        #[cfg(target_os = "linux")]
        assert!(ports.contains(&7896));
    }
}

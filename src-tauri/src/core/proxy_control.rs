use crate::{
    config::{Config, IVerge},
    core::{CoreManager, manager::RunningMode, service, sysopt::Sysopt},
    process::AsyncHandler,
    utils::server,
};
use anyhow::{Result, bail, ensure};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::{MacosProxyConfig, ProxyApplyOutcome};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

const LOOPBACK_HOST: &str = "127.0.0.1";
const MACOS_DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";
const MAX_SERVICE_BYPASS_LEN: usize = 8192;

static SERVICE_GUARD_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyBackendRoute {
    Local,
    Service,
}

const fn proxy_backend_route(is_macos: bool, running_mode: &RunningMode) -> ProxyBackendRoute {
    if is_macos && matches!(running_mode, RunningMode::Service) {
        ProxyBackendRoute::Service
    } else {
        ProxyBackendRoute::Local
    }
}

fn guard_generation_is_current(generation: &AtomicU64, captured_generation: u64) -> bool {
    generation.load(Ordering::Acquire) == captured_generation
}

fn truncate_utf8(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
}

fn service_bypass(verge: &IVerge) -> Result<String> {
    let custom = verge.system_proxy_bypass.as_deref().unwrap_or("");
    ensure!(!custom.contains('\0'), "system proxy bypass contains NUL");

    let mut bypass = if custom.is_empty() {
        MACOS_DEFAULT_BYPASS.to_owned()
    } else if verge.use_default_bypass.unwrap_or(true) {
        format!("{MACOS_DEFAULT_BYPASS},{custom}")
    } else {
        custom.to_owned()
    };
    truncate_utf8(&mut bypass, MAX_SERVICE_BYPASS_LEN);
    Ok(bypass)
}

fn service_proxy_config(verge: &IVerge, mixed_port: u16, pac_port: u16) -> Result<MacosProxyConfig> {
    if !verge.enable_system_proxy.unwrap_or_default() {
        return Ok(MacosProxyConfig::Disabled);
    }

    if verge.proxy_auto_config.unwrap_or_default() {
        ensure!(pac_port != 0, "embedded PAC server port must not be zero");
        Ok(MacosProxyConfig::Pac {
            url: format!("http://{LOOPBACK_HOST}:{pac_port}/commands/pac"),
        })
    } else {
        ensure!(mixed_port != 0, "system proxy port must not be zero");
        Ok(MacosProxyConfig::Global {
            host: LOOPBACK_HOST.to_owned(),
            port: mixed_port,
            bypass: service_bypass(verge)?,
        })
    }
}

fn service_apply_result(outcome: ProxyApplyOutcome) -> Result<()> {
    match outcome {
        ProxyApplyOutcome::Applied | ProxyApplyOutcome::NotRequested => Ok(()),
        ProxyApplyOutcome::DirectFallback { message } => bail!(message),
    }
}

async fn current_service_proxy_config(verge: &IVerge) -> Result<MacosProxyConfig> {
    if !verge.enable_system_proxy.unwrap_or_default() {
        return Ok(MacosProxyConfig::Disabled);
    }
    if verge.proxy_auto_config.unwrap_or_default() {
        return service_proxy_config(verge, 0, server::embedded_server_port()?);
    }
    let mixed_port = match verge.verge_mixed_port {
        Some(port) => port,
        None => Config::clash().await.latest_arc().get_mixed_port(),
    };
    service_proxy_config(verge, mixed_port, 0)
}

pub async fn apply() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => Sysopt::global().update_sysproxy().await,
        ProxyBackendRoute::Service => {
            let verge = Config::verge().await.latest_arc();
            let proxy = current_service_proxy_config(&verge).await?;
            service_apply_result(service::set_system_proxy_by_service(&proxy).await?)
        }
    }
}

pub async fn clear() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => Sysopt::global().reset_sysproxy().await,
        ProxyBackendRoute::Service => {
            service_apply_result(service::set_system_proxy_by_service(&MacosProxyConfig::Disabled).await?)
        }
    }
}

pub async fn refresh_guard() -> Result<()> {
    let generation = SERVICE_GUARD_GENERATION.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
    let running_mode = CoreManager::global().get_running_mode();
    if matches!(
        proxy_backend_route(cfg!(target_os = "macos"), &running_mode),
        ProxyBackendRoute::Local
    ) {
        Sysopt::global().refresh_guard().await;
        return Ok(());
    }

    Sysopt::global().stop_proxy_guard().await;
    let verge = Config::verge().await.latest_arc();
    if !verge.enable_system_proxy.unwrap_or_default() || !verge.enable_proxy_guard.unwrap_or_default() {
        return Ok(());
    }

    let proxy = current_service_proxy_config(&verge).await?;
    let interval = Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30).max(1));
    AsyncHandler::spawn(move || async move {
        loop {
            tokio::time::sleep(interval).await;
            if !guard_generation_is_current(&SERVICE_GUARD_GENERATION, generation)
                || !matches!(*CoreManager::global().get_running_mode(), RunningMode::Service)
                || service::active_service_session().is_err()
            {
                break;
            }
            if service::set_system_proxy_by_service(&proxy).await.is_err() {
                logging!(warn, Type::Core, "failed to refresh system proxy through Service");
            }
        }
    });
    Ok(())
}

pub async fn stop_guard() {
    SERVICE_GUARD_GENERATION.fetch_add(1, Ordering::AcqRel);
    Sysopt::global().stop_proxy_guard().await;
}

#[cfg(test)]
mod tests {
    use super::{ProxyBackendRoute, guard_generation_is_current, proxy_backend_route, service_proxy_config};
    use crate::{config::IVerge, core::manager::RunningMode};
    use clash_verge_service_ipc::MacosProxyConfig;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn only_macos_service_routes_proxy_to_helper() {
        assert_eq!(
            proxy_backend_route(true, &RunningMode::Service),
            ProxyBackendRoute::Service
        );
        assert_eq!(
            proxy_backend_route(true, &RunningMode::Sidecar),
            ProxyBackendRoute::Local
        );
        assert_eq!(
            proxy_backend_route(false, &RunningMode::Service),
            ProxyBackendRoute::Local
        );
    }

    #[test]
    fn stale_periodic_refresh_stops_after_owner_loss() {
        let generation = AtomicU64::new(7);
        let captured_generation = generation.load(Ordering::Acquire);

        assert!(guard_generation_is_current(&generation, captured_generation));
        generation.fetch_add(1, Ordering::AcqRel);
        assert!(!guard_generation_is_current(&generation, captured_generation));
    }

    #[test]
    fn service_proxy_config_forces_loopback_targets_and_bounds_bypass() {
        let verge = IVerge {
            enable_system_proxy: Some(true),
            proxy_auto_config: Some(false),
            proxy_host: Some("192.0.2.1".into()),
            system_proxy_bypass: Some(format!("{}界", "x".repeat(8191)).into()),
            use_default_bypass: Some(false),
            ..IVerge::default()
        };

        let proxy = service_proxy_config(&verge, 7897, 3333).unwrap_or_else(|_| unreachable!());
        let MacosProxyConfig::Global { host, port, bypass } = proxy else {
            unreachable!();
        };

        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, 7897);
        assert!(bypass.len() <= 8192);
        assert!(bypass.is_char_boundary(bypass.len()));

        let pac_verge = IVerge {
            proxy_auto_config: Some(true),
            ..verge
        };
        assert_eq!(
            service_proxy_config(&pac_verge, 7897, 3333).unwrap_or_else(|_| unreachable!()),
            MacosProxyConfig::Pac {
                url: "http://127.0.0.1:3333/commands/pac".to_owned()
            }
        );
    }
}

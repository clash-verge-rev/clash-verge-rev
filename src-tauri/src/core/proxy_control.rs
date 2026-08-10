use crate::{
    config::{Config, IVerge, MixedPort},
    core::{CoreManager, manager::RunningMode, service, sysopt::Sysopt},
    process::AsyncHandler,
    utils::server,
};
use anyhow::{Result, ensure};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::{MacosProxyConfig, OwnerSessionProof, ProxyApplyOutcome};
use std::{
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::Mutex;

/// Actionable system-proxy failure attached to an `anyhow` chain.
///
/// Classification remains downcastable while the original error stays available for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SysproxyFailure {
    /// A local `networksetup` write lacked privileges.
    PrivilegeRequired,
    /// The service failed to apply the proxy and attempted direct fallback.
    DirectFallback { detail: String },
}

impl SysproxyFailure {
    /// Stable frontend error code.
    #[inline]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::PrivilegeRequired => "SYSPROXY_PRIVILEGE_REQUIRED",
            Self::DirectFallback { .. } => "SYSPROXY_DIRECT_FALLBACK",
        }
    }

    /// Find a classification using `anyhow`'s context-aware downcast.
    #[inline]
    pub fn from_chain(error: &anyhow::Error) -> Option<&Self> {
        error.downcast_ref::<Self>()
    }
}

impl std::fmt::Display for SysproxyFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PrivilegeRequired => f.write_str("system proxy write requires elevated privileges"),
            Self::DirectFallback { detail } => {
                write!(f, "system proxy failed and fell back to direct: {detail}")
            }
        }
    }
}

impl std::error::Error for SysproxyFailure {}

/// Classify local macOS proxy failures without replacing their source chain.
fn classify_local_failure(error: anyhow::Error) -> anyhow::Error {
    if !cfg!(target_os = "macos") {
        return error;
    }

    let refused = error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<sysproxy::Error>(),
            Some(sysproxy::Error::RequiresAdminPrivileges)
        )
    });

    if refused {
        error.context(SysproxyFailure::PrivilegeRequired)
    } else {
        error
    }
}

const LOOPBACK_HOST: &str = "127.0.0.1";
const MACOS_DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";
const MAX_SERVICE_BYPASS_LEN: usize = 8192;

static SERVICE_PROXY_OPERATIONS: ServiceProxyOperations = ServiceProxyOperations::new();

struct ServiceProxyOperations {
    guard_generation: AtomicU64,
    operation_lock: Mutex<()>,
}

impl ServiceProxyOperations {
    const fn new() -> Self {
        Self {
            guard_generation: AtomicU64::new(0),
            operation_lock: Mutex::const_new(()),
        }
    }

    fn invalidate_guard(&self) -> u64 {
        self.guard_generation.fetch_add(1, Ordering::AcqRel).wrapping_add(1)
    }

    async fn run_service_operation<F, Fut, T>(&self, operation: F) -> T
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        let _operation = self.operation_lock.lock().await;
        operation().await
    }

    async fn run_final_service_operation<F, Fut, T>(&self, operation: F) -> T
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        self.invalidate_guard();
        self.run_service_operation(operation).await
    }

    async fn cancel_and_drain<F, Fut>(&self, cancel: F) -> u64
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = ()>,
    {
        let generation = self.invalidate_guard();
        self.run_service_operation(cancel).await;
        generation
    }

    async fn run_guard_request<Mode, ActiveProof, Request, RequestFuture>(
        &self,
        captured_generation: u64,
        captured_proof: &OwnerSessionProof,
        is_service_mode: Mode,
        active_proof: ActiveProof,
        request: Request,
    ) -> Result<bool>
    where
        Mode: FnOnce() -> bool,
        ActiveProof: FnOnce() -> Result<OwnerSessionProof>,
        Request: FnOnce() -> RequestFuture,
        RequestFuture: Future<Output = Result<ProxyApplyOutcome>>,
    {
        self.run_service_operation(|| async move {
            if !guard_generation_is_current(&self.guard_generation, captured_generation)
                || !is_service_mode()
                || !active_proof().is_ok_and(|active| active == *captured_proof)
            {
                return Ok(false);
            }
            service_apply_result(request().await?)?;
            Ok(true)
        })
        .await
    }
}

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
        // Preserve the direct-fallback classification.
        ProxyApplyOutcome::DirectFallback { message } => {
            Err(SysproxyFailure::DirectFallback { detail: message }.into())
        }
    }
}

async fn current_service_proxy_config(verge: &IVerge) -> Result<MacosProxyConfig> {
    if !verge.enable_system_proxy.unwrap_or_default() {
        return Ok(MacosProxyConfig::Disabled);
    }
    if verge.proxy_auto_config.unwrap_or_default() {
        return service_proxy_config(verge, 0, server::embedded_server_port()?);
    }
    // Configured: this builds the proxy settings handed to the service alongside a start.
    let mixed_port = MixedPort::desired().await;
    service_proxy_config(verge, mixed_port, 0)
}

pub async fn apply() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => Sysopt::global().update_sysproxy().await.map_err(classify_local_failure),
        ProxyBackendRoute::Service => {
            let verge = Config::verge().await.latest_arc();
            let proxy = current_service_proxy_config(&verge).await?;
            SERVICE_PROXY_OPERATIONS
                .run_final_service_operation(|| async {
                    service_apply_result(service::set_system_proxy_by_service(&proxy).await?)
                })
                .await
        }
    }
}

pub async fn clear() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => Sysopt::global().reset_sysproxy().await.map_err(classify_local_failure),
        ProxyBackendRoute::Service => {
            SERVICE_PROXY_OPERATIONS
                .run_final_service_operation(|| async {
                    service_apply_result(service::set_system_proxy_by_service(&MacosProxyConfig::Disabled).await?)
                })
                .await
        }
    }
}

pub async fn refresh_guard() -> Result<()> {
    let generation = SERVICE_PROXY_OPERATIONS
        .cancel_and_drain(|| Sysopt::global().stop_proxy_guard())
        .await;
    let running_mode = CoreManager::global().get_running_mode();
    if matches!(
        proxy_backend_route(cfg!(target_os = "macos"), &running_mode),
        ProxyBackendRoute::Local
    ) {
        Sysopt::global().refresh_guard().await;
        return Ok(());
    }

    let verge = Config::verge().await.latest_arc();
    if !verge.enable_system_proxy.unwrap_or_default() || !verge.enable_proxy_guard.unwrap_or_default() {
        return Ok(());
    }

    let proxy = current_service_proxy_config(&verge).await?;
    let proof = service::active_service_session()?;
    let interval = Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30).max(1));
    AsyncHandler::spawn(move || async move {
        loop {
            tokio::time::sleep(interval).await;
            match SERVICE_PROXY_OPERATIONS
                .run_guard_request(
                    generation,
                    &proof,
                    || matches!(*CoreManager::global().get_running_mode(), RunningMode::Service),
                    service::active_service_session,
                    || service::set_system_proxy_by_service_with_session(&proxy, &proof),
                )
                .await
            {
                Ok(true) => {}
                Ok(false) => break,
                Err(_) => logging!(warn, Type::Core, "failed to refresh system proxy through Service"),
            }
        }
    });
    Ok(())
}

pub async fn stop_guard() {
    SERVICE_PROXY_OPERATIONS
        .cancel_and_drain(|| Sysopt::global().stop_proxy_guard())
        .await;
}

#[cfg(test)]
mod tests {
    use super::{
        ProxyBackendRoute, ServiceProxyOperations, guard_generation_is_current, proxy_backend_route,
        service_proxy_config,
    };
    use crate::{config::IVerge, core::manager::RunningMode};
    use clash_verge_service_ipc::{MacosProxyConfig, OwnerSessionProof, ProxyApplyOutcome};
    use parking_lot::Mutex;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    };
    use std::task::Poll;
    use tokio::sync::Barrier;

    fn proof(generation: u64, token: &str) -> OwnerSessionProof {
        OwnerSessionProof {
            generation,
            token: token.to_owned(),
        }
    }

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

    #[tokio::test]
    async fn final_service_mutation_finishes_after_in_flight_guard_request() {
        let operations = Arc::new(ServiceProxyOperations::new());
        let generation = operations.invalidate_guard();
        let captured_proof = proof(1, "captured");
        let active_proof = Arc::new(Mutex::new(captured_proof.clone()));
        let guard_started = Arc::new(Barrier::new(2));
        let release_guard = Arc::new(Barrier::new(2));
        let events = Arc::new(Mutex::new(Vec::new()));

        let guard_task = {
            let operations = Arc::clone(&operations);
            let captured_proof = captured_proof.clone();
            let active_proof = Arc::clone(&active_proof);
            let guard_started = Arc::clone(&guard_started);
            let release_guard = Arc::clone(&release_guard);
            let events = Arc::clone(&events);
            tokio::spawn(async move {
                operations
                    .run_guard_request(
                        generation,
                        &captured_proof,
                        || true,
                        || Ok(active_proof.lock().clone()),
                        || async {
                            events.lock().push("guard-started");
                            guard_started.wait().await;
                            release_guard.wait().await;
                            events.lock().push("guard-finished");
                            Ok(ProxyApplyOutcome::Applied)
                        },
                    )
                    .await
            })
        };
        guard_started.wait().await;

        let mut final_operation = Box::pin(operations.run_final_service_operation(|| async {
            events.lock().push("final");
            Ok::<_, anyhow::Error>(())
        }));
        assert!(matches!(futures::poll!(final_operation.as_mut()), Poll::Pending));
        assert!(!guard_generation_is_current(&operations.guard_generation, generation));
        release_guard.wait().await;

        assert!(matches!(guard_task.await, Ok(Ok(true))));
        assert!(matches!(final_operation.await, Ok(())));
        assert_eq!(&*events.lock(), &["guard-started", "guard-finished", "final"]);
    }

    #[tokio::test]
    async fn generation_invalidation_while_guard_waits_prevents_rpc() {
        let operations = Arc::new(ServiceProxyOperations::new());
        let generation = operations.invalidate_guard();
        let captured_proof = proof(1, "captured");
        let blocker_started = Arc::new(Barrier::new(2));
        let release_blocker = Arc::new(Barrier::new(2));

        let blocker = {
            let operations = Arc::clone(&operations);
            let blocker_started = Arc::clone(&blocker_started);
            let release_blocker = Arc::clone(&release_blocker);
            tokio::spawn(async move {
                operations
                    .run_service_operation(|| async {
                        blocker_started.wait().await;
                        release_blocker.wait().await;
                    })
                    .await
            })
        };
        blocker_started.wait().await;

        let rpc_called = AtomicBool::new(false);
        let mut guard_request = Box::pin(operations.run_guard_request(
            generation,
            &captured_proof,
            || true,
            || Ok(captured_proof.clone()),
            || async {
                rpc_called.store(true, Ordering::Release);
                Ok(ProxyApplyOutcome::Applied)
            },
        ));
        assert!(matches!(futures::poll!(guard_request.as_mut()), Poll::Pending));
        operations.invalidate_guard();
        release_blocker.wait().await;

        assert!(blocker.await.is_ok());
        assert!(matches!(guard_request.await, Ok(false)));
        assert!(!rpc_called.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn old_guard_loop_does_not_adopt_replacement_proof() {
        let operations = Arc::new(ServiceProxyOperations::new());
        let generation = operations.invalidate_guard();
        let captured_proof = proof(1, "captured");
        let replacement_proof = proof(2, "replacement");
        let active_proof = Mutex::new(captured_proof.clone());
        let rpc_called = AtomicBool::new(false);
        let blocker_started = Arc::new(Barrier::new(2));
        let release_blocker = Arc::new(Barrier::new(2));

        let blocker = {
            let operations = Arc::clone(&operations);
            let blocker_started = Arc::clone(&blocker_started);
            let release_blocker = Arc::clone(&release_blocker);
            tokio::spawn(async move {
                operations
                    .run_service_operation(|| async {
                        blocker_started.wait().await;
                        release_blocker.wait().await;
                    })
                    .await
            })
        };
        blocker_started.wait().await;

        let mut guard_request = Box::pin(operations.run_guard_request(
            generation,
            &captured_proof,
            || true,
            || Ok(active_proof.lock().clone()),
            || async {
                rpc_called.store(true, Ordering::Release);
                Ok(ProxyApplyOutcome::Applied)
            },
        ));
        assert!(matches!(futures::poll!(guard_request.as_mut()), Poll::Pending));
        *active_proof.lock() = replacement_proof;
        release_blocker.wait().await;

        assert!(blocker.await.is_ok());
        assert!(matches!(guard_request.await, Ok(false)));
        assert!(!rpc_called.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn guard_refresh_rejects_direct_fallback() {
        let operations = ServiceProxyOperations::new();
        let generation = operations.invalidate_guard();
        let captured_proof = proof(1, "captured");

        let refreshed = operations
            .run_guard_request(
                generation,
                &captured_proof,
                || true,
                || Ok(captured_proof.clone()),
                || async {
                    Ok(ProxyApplyOutcome::DirectFallback {
                        message: "fallback detail".to_owned(),
                    })
                },
            )
            .await;

        assert!(refreshed.is_err());
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

    use super::{SysproxyFailure, classify_local_failure};

    fn wrapped_privilege_failure() -> anyhow::Error {
        anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges).context("failed to apply the system proxy")
    }

    fn classified_privilege_failure() -> anyhow::Error {
        wrapped_privilege_failure().context(SysproxyFailure::PrivilegeRequired)
    }

    #[test]
    fn a_classification_survives_the_anyhow_layers_above_it() {
        let classified = classified_privilege_failure()
            .context("failed to apply system proxy after start")
            .context("failed to restart the core");

        assert_eq!(
            SysproxyFailure::from_chain(&classified).map(SysproxyFailure::code),
            Some("SYSPROXY_PRIVILEGE_REQUIRED")
        );
    }

    #[test]
    fn classifying_keeps_the_original_failure_underneath() {
        let classified = classified_privilege_failure();

        assert!(
            classified.chain().any(|cause| matches!(
                cause.downcast_ref::<sysproxy::Error>(),
                Some(sysproxy::Error::RequiresAdminPrivileges)
            )),
            "the original error must survive classification: {classified:#}"
        );
        assert!(format!("{classified:#}").contains("failed to apply the system proxy"));
    }

    #[test]
    fn an_unrelated_failure_is_left_alone() {
        let untouched = classify_local_failure(anyhow::anyhow!("port already in use"));

        assert!(SysproxyFailure::from_chain(&untouched).is_none());
        assert_eq!(format!("{untouched:#}"), "port already in use");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_refused_write_is_classified_on_macos() {
        let classified = classify_local_failure(wrapped_privilege_failure());

        assert!(matches!(
            SysproxyFailure::from_chain(&classified),
            Some(SysproxyFailure::PrivilegeRequired)
        ));

        assert!(
            classified.chain().any(|cause| matches!(
                cause.downcast_ref::<sysproxy::Error>(),
                Some(sysproxy::Error::RequiresAdminPrivileges)
            )),
            "classifying must keep the original failure reachable: {classified:#}"
        );
        assert!(format!("{classified:#}").contains("failed to apply the system proxy"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn nothing_is_classified_off_macos() {
        let classified = classify_local_failure(wrapped_privilege_failure());

        assert!(SysproxyFailure::from_chain(&classified).is_none());
    }

    #[test]
    fn a_direct_fallback_reports_that_traffic_may_be_going_direct() {
        let outcome = ProxyApplyOutcome::DirectFallback {
            message: "service could not set the proxy".to_owned(),
        };

        let error = super::service_apply_result(outcome)
            .err()
            .unwrap_or_else(|| anyhow::anyhow!("a fallback outcome must be reported as a failure"));

        assert_eq!(
            SysproxyFailure::from_chain(&error).map(SysproxyFailure::code),
            Some("SYSPROXY_DIRECT_FALLBACK")
        );
        assert!(format!("{error:#}").contains("service could not set the proxy"));
    }
}

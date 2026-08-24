use crate::{
    config::{Config, IVerge, MixedPort},
    core::{
        CoreManager,
        manager::RunningMode,
        notification::{self, FailedOperation},
        runstate::RUN_STATE,
        service,
        sysopt::Sysopt,
    },
    process::AsyncHandler,
    utils::{
        notification::{NotificationEvent, needs_system_notification, notify_event},
        server,
        window_manager::WindowManager,
    },
};
use anyhow::{Result, ensure};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::{MacosProxyConfig, OwnerSessionProof, ProxyApplyOutcome};
use std::{
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::{sync::Mutex, time::timeout};

const CLEAR_ATTEMPTS: u32 = 3;
const CLEAR_RETRY_DELAY: Duration = Duration::from_millis(100);

/// Actionable system-proxy failure attached to an `anyhow` chain.
///
/// Classification remains downcastable while the original error stays available for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SysproxyFailure {
    /// A local `networksetup` write lacked privileges.
    PrivilegeRequired,
    /// The service failed to apply the proxy and attempted direct fallback.
    DirectFallback { detail: String },
    /// A ready service can replace the refused sidecar write.
    SidecarWhileServiceReady,
    /// The proxy guard stopped after repeated failures.
    GuardStopped { detail: String },
    /// The Core was not ready, so enabling the system proxy was refused.
    CoreNotReady,
    /// A Windows system call refused the write, usually a transient RPC hiccup.
    SystemCallFailed,
}

impl SysproxyFailure {
    #[inline]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::PrivilegeRequired => "SYSPROXY_PRIVILEGE_REQUIRED",
            Self::DirectFallback { .. } => "SYSPROXY_DIRECT_FALLBACK",
            Self::SidecarWhileServiceReady => "SYSPROXY_SIDECAR_WHILE_SERVICE_READY",
            Self::GuardStopped { .. } => "SYSPROXY_GUARD_STOPPED",
            Self::CoreNotReady => "SYSPROXY_CORE_NOT_READY",
            Self::SystemCallFailed => "SYSPROXY_SYSTEM_CALL_FAILED",
        }
    }

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
            Self::SidecarWhileServiceReady => {
                f.write_str("system proxy write was refused locally while the service was ready")
            }
            Self::GuardStopped { detail } => {
                write!(f, "system proxy guard stopped after repeated failures: {detail}")
            }
            Self::CoreNotReady => f.write_str("the core is not ready, so the system proxy was not enabled"),
            Self::SystemCallFailed => f.write_str("a Windows system call failed while writing the system proxy"),
        }
    }
}

impl std::error::Error for SysproxyFailure {}

/// Marker for a partially applied system proxy write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemProxyStateUnknown;

impl SystemProxyStateUnknown {
    #[inline]
    pub fn is_in(error: &anyhow::Error) -> bool {
        error.downcast_ref::<Self>().is_some()
    }
}

impl std::fmt::Display for SystemProxyStateUnknown {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the system proxy was left partly applied; turning it off was attempted")
    }
}

impl std::error::Error for SystemProxyStateUnknown {}

#[inline]
fn carries_a_mappable_code(error: &anyhow::Error) -> bool {
    SysproxyFailure::from_chain(error).is_some()
}

/// Combine a cause with rollback failure without hiding actionable classifications.
pub fn rollback_failure(caused_by: anyhow::Error, rollback: anyhow::Error) -> anyhow::Error {
    let state_unknown = SystemProxyStateUnknown::is_in(&caused_by) || SystemProxyStateUnknown::is_in(&rollback);

    let combined = if carries_a_mappable_code(&caused_by) || !carries_a_mappable_code(&rollback) {
        caused_by.context(format!("the rollback that followed also failed: {rollback:#}"))
    } else {
        rollback.context(format!("this rollback followed an earlier failure: {caused_by:#}"))
    };

    if state_unknown && !SystemProxyStateUnknown::is_in(&combined) {
        return combined.context(SystemProxyStateUnknown);
    }
    combined
}

fn classify_local_failure(error: anyhow::Error) -> anyhow::Error {
    if was_refused_locally(&error) {
        return error.context(SysproxyFailure::PrivilegeRequired);
    }
    if was_a_failed_system_call(&error) {
        return error.context(SysproxyFailure::SystemCallFailed);
    }
    error
}

#[cfg(target_os = "windows")]
fn was_a_failed_system_call(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<sysproxy::Error>(),
            Some(sysproxy::Error::SystemCall(_))
        )
    })
}

#[cfg(not(target_os = "windows"))]
const fn was_a_failed_system_call(_error: &anyhow::Error) -> bool {
    false
}

fn was_refused_locally(error: &anyhow::Error) -> bool {
    cfg!(target_os = "macos")
        && error.chain().any(|cause| {
            matches!(
                cause.downcast_ref::<sysproxy::Error>(),
                Some(sysproxy::Error::RequiresAdminPrivileges)
            )
        })
}

/// Distinguish a misplaced sidecar from a missing privileged service.
async fn classify_local_apply_failure(error: anyhow::Error) -> anyhow::Error {
    if SysproxyFailure::from_chain(&error).is_some() || !was_refused_locally(&error) {
        return error;
    }
    let probed = timeout(SERVICE_PROBE_TIMEOUT, RUN_STATE.probe())
        .await
        .ok()
        .and_then(|probe| probe.ok())
        .map(|fresh| fresh.service_usable());
    error.context(refusal_classification(probed))
}

const SERVICE_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Classify a refusal from a fresh service probe only.
const fn refusal_classification(service_usable: Option<bool>) -> SysproxyFailure {
    match service_usable {
        Some(true) => SysproxyFailure::SidecarWhileServiceReady,
        Some(false) | None => SysproxyFailure::PrivilegeRequired,
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

    async fn cancel_and_drain<F, Fut, T>(&self, cancel: F) -> (u64, T)
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        let generation = self.invalidate_guard();
        let cancelled = self.run_service_operation(cancel).await;
        (generation, cancelled)
    }

    async fn record_if_current<Record>(&self, captured_generation: u64, record: Record) -> bool
    where
        Record: FnOnce() -> bool,
    {
        self.run_service_operation(|| async move {
            guard_generation_is_current(&self.guard_generation, captured_generation) && record()
        })
        .await
    }

    async fn run_guard_request<Mode, ActiveProof, Request, RequestFuture>(
        &self,
        captured_generation: u64,
        captured_proof: &OwnerSessionProof,
        requested: &MacosProxyConfig,
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
            service_apply_result(requested, request().await?)?;
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

fn service_apply_result(requested: &MacosProxyConfig, outcome: ProxyApplyOutcome) -> Result<()> {
    match outcome {
        ProxyApplyOutcome::Applied | ProxyApplyOutcome::NotRequested => Ok(()),
        // Direct fallback satisfies a disable request.
        ProxyApplyOutcome::DirectFallback { .. } if matches!(requested, MacosProxyConfig::Disabled) => Ok(()),
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
    let mixed_port = MixedPort::desired().await;
    service_proxy_config(verge, mixed_port, 0)
}

pub fn is_reportable(error: &anyhow::Error) -> bool {
    is_reportable_given(error, notification::has_pending_failure)
}

fn is_reportable_given(error: &anyhow::Error, still_pending: impl FnOnce(&str) -> bool) -> bool {
    SysproxyFailure::from_chain(error).is_some_and(|failure| still_pending(failure.code()))
}

pub fn report_failure(operation: FailedOperation, error: &anyhow::Error) -> bool {
    let Some(failure) = SysproxyFailure::from_chain(error) else {
        return false;
    };
    notification::record_failure(operation, failure.code(), format!("{error:#}"));
    true
}

/// Drain any local guard before writing through the service.
async fn apply_through_service<Drain, DrainFuture, Write, WriteFuture>(
    drain_local_guard: Drain,
    write: Write,
) -> Result<()>
where
    Drain: FnOnce() -> DrainFuture,
    DrainFuture: Future<Output = bool>,
    Write: FnOnce() -> WriteFuture,
    WriteFuture: Future<Output = Result<()>>,
{
    ensure!(
        drain_local_guard().await,
        "the system proxy guard did not stop in time; not writing the system proxy through the service"
    );
    write().await
}

#[derive(Debug)]
enum TableEffect<'a> {
    Retire { enabled: bool },
    File(FailedOperation, &'a anyhow::Error),
    Nothing,
}

/// A successful clear does not resolve a failed request to enable the proxy.
fn clear_table_effect(result: &Result<()>) -> TableEffect<'_> {
    match result {
        Err(error) if SysproxyFailure::from_chain(error).is_some() => {
            TableEffect::File(notification::what_was_asked(), error)
        }
        Ok(()) | Err(_) => TableEffect::Nothing,
    }
}

fn settle_table<Retire, File>(effect: TableEffect<'_>, retire: Retire, file: File)
where
    Retire: FnOnce(bool),
    File: FnOnce(FailedOperation, &anyhow::Error),
{
    match effect {
        TableEffect::Retire { enabled } => retire(enabled),
        TableEffect::File(operation, error) => file(operation, error),
        TableEffect::Nothing => {}
    }
}

fn table_effect(result: &Result<()>, enabled: bool) -> TableEffect<'_> {
    match result {
        Ok(()) => TableEffect::Retire { enabled },
        Err(error) if SysproxyFailure::from_chain(error).is_some() => {
            TableEffect::File(notification::what_was_asked(), error)
        }
        Err(_) => TableEffect::Nothing,
    }
}

pub async fn apply() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    // Use the pre-apply snapshot when retiring matching failures.
    let verge = Config::verge().await.latest_arc();
    let enabled = verge.enable_system_proxy.unwrap_or_default();
    let result = match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => match Sysopt::global().update_sysproxy().await {
            Ok(()) => Ok(()),
            Err(error) => Err(classify_local_apply_failure(error).await),
        },
        ProxyBackendRoute::Service => {
            let proxy = current_service_proxy_config(&verge).await?;
            apply_through_service(
                || Sysopt::global().stop_proxy_guard(),
                || async {
                    SERVICE_PROXY_OPERATIONS
                        .run_final_service_operation(|| async {
                            service_apply_result(&proxy, service::set_system_proxy_by_service(&proxy).await?)
                        })
                        .await
                },
            )
            .await
        }
    };
    // Settle failures where every proxy-apply path converges.
    settle_table(
        table_effect(&result, enabled),
        notification::retire_system_proxy_failures,
        |operation, error| {
            report_failure(operation, error);
        },
    );
    result
}

pub async fn clear() -> Result<()> {
    let result = clear_with_retry().await;
    // Clear failures must be filed even when a restart aborts before apply.
    settle_table(
        clear_table_effect(&result),
        notification::retire_system_proxy_failures,
        |operation, error| {
            report_failure(operation, error);
        },
    );
    result
}

/// A failed system call is usually a transient RPC hiccup, so give it a few tries.
async fn clear_with_retry() -> Result<()> {
    for _ in 1..CLEAR_ATTEMPTS {
        match clear_inner().await {
            Err(error)
                if matches!(
                    SysproxyFailure::from_chain(&error),
                    Some(SysproxyFailure::SystemCallFailed)
                ) =>
            {
                logging!(
                    warn,
                    Type::Core,
                    "clearing the system proxy failed; retrying: {error:#}"
                );
                tokio::time::sleep(CLEAR_RETRY_DELAY).await;
            }
            other => return other,
        }
    }
    clear_inner().await
}

async fn clear_inner() -> Result<()> {
    let running_mode = CoreManager::global().get_running_mode();
    match proxy_backend_route(cfg!(target_os = "macos"), &running_mode) {
        ProxyBackendRoute::Local => Sysopt::global().reset_sysproxy().await.map_err(classify_local_failure),
        ProxyBackendRoute::Service => {
            SERVICE_PROXY_OPERATIONS
                .run_final_service_operation(|| async {
                    service_apply_result(
                        &MacosProxyConfig::Disabled,
                        service::set_system_proxy_by_service(&MacosProxyConfig::Disabled).await?,
                    )
                })
                .await
        }
    }
}

pub async fn refresh_guard() -> Result<()> {
    let (generation, _drained) = SERVICE_PROXY_OPERATIONS
        .cancel_and_drain(|| Sysopt::global().stop_proxy_guard())
        .await;
    let running_mode = CoreManager::global().get_running_mode();
    if matches!(
        proxy_backend_route(cfg!(target_os = "macos"), &running_mode),
        ProxyBackendRoute::Local
    ) {
        // Retire the warning only after a guard is enforcing.
        if Sysopt::global().refresh_guard().await {
            notification::retire_guard_failures();
        }
        return Ok(());
    }

    let verge = Config::verge().await.latest_arc();
    if !verge.enable_system_proxy.unwrap_or_default() || !verge.enable_proxy_guard.unwrap_or_default() {
        notification::retire_guard_failures();
        return Ok(());
    }

    let proxy = current_service_proxy_config(&verge).await?;
    let proof = service::active_service_session()?;
    let interval = Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30).max(1));
    AsyncHandler::spawn(move || async move {
        let mut consecutive_failures = 0u32;
        loop {
            tokio::time::sleep(interval).await;
            match SERVICE_PROXY_OPERATIONS
                .run_guard_request(
                    generation,
                    &proof,
                    &proxy,
                    || matches!(*CoreManager::global().get_running_mode(), RunningMode::Service),
                    service::active_service_session,
                    || service::set_system_proxy_by_service_with_session(&proxy, &proof),
                )
                .await
            {
                Ok(true) => consecutive_failures = 0,
                Ok(false) => break,
                Err(error) => {
                    consecutive_failures += 1;
                    logging!(
                        warn,
                        Type::Core,
                        "failed to refresh system proxy through Service ({}/{}): {:#}",
                        consecutive_failures,
                        GUARD_FAILURES_BEFORE_STOPPING,
                        error
                    );
                    if consecutive_failures >= GUARD_FAILURES_BEFORE_STOPPING {
                        report_guard_stopped(generation, &error).await;
                        break;
                    }
                }
            }
        }
    });
    // Retire only after the replacement guard starts successfully.
    notification::retire_guard_failures();
    Ok(())
}

const GUARD_FAILURES_BEFORE_STOPPING: u32 = 3;

async fn report_guard_stopped(captured_generation: u64, error: &anyhow::Error) {
    let stopped = anyhow::Error::new(SysproxyFailure::GuardStopped {
        detail: format!("{error:#}"),
    });
    // Do not publish a late failure from a replaced guard.
    let recorded = SERVICE_PROXY_OPERATIONS
        .record_if_current(captured_generation, || {
            report_failure(FailedOperation::SystemProxyGuard, &stopped)
        })
        .await;

    if recorded && needs_system_notification(WindowManager::get_main_window_state()) {
        notify_event(NotificationEvent::SystemProxyGuardStopped).await;
    }
}

pub async fn stop_guard() -> bool {
    SERVICE_PROXY_OPERATIONS
        .cancel_and_drain(|| Sysopt::global().stop_proxy_guard())
        .await
        .1
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
        atomic::{AtomicBool, Ordering},
    };
    use std::task::Poll;
    use tokio::sync::Barrier;

    fn guarded_proxy() -> MacosProxyConfig {
        MacosProxyConfig::Global {
            host: "127.0.0.1".to_owned(),
            port: 7897,
            bypass: "localhost".to_owned(),
        }
    }

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
                        &guarded_proxy(),
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
        let guarded = guarded_proxy();
        let mut guard_request = Box::pin(operations.run_guard_request(
            generation,
            &captured_proof,
            &guarded,
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

        let guarded = guarded_proxy();
        let mut guard_request = Box::pin(operations.run_guard_request(
            generation,
            &captured_proof,
            &guarded,
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
                &guarded_proxy(),
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

    #[tokio::test]
    async fn a_report_waiting_on_the_lock_says_nothing_if_it_is_invalidated_meanwhile() {
        // The generation check must happen after acquiring the operation lock.
        let operations = Arc::new(ServiceProxyOperations::new());
        let generation = operations.invalidate_guard();
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

        let recorded = AtomicBool::new(false);
        let mut report = Box::pin(operations.record_if_current(generation, || {
            recorded.store(true, Ordering::Release);
            true
        }));
        assert!(matches!(futures::poll!(report.as_mut()), Poll::Pending));
        operations.invalidate_guard();
        release_blocker.wait().await;

        assert!(blocker.await.is_ok());
        assert!(!report.await);
        assert!(!recorded.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn a_current_guard_still_reports() {
        let operations = ServiceProxyOperations::new();
        let generation = operations.invalidate_guard();

        assert!(operations.record_if_current(generation, || true).await);
    }

    async fn record_service_apply(drained: bool, write_succeeds: bool) -> (Vec<&'static str>, bool) {
        let calls = Mutex::new(Vec::new());
        let result = super::apply_through_service(
            || {
                calls.lock().push("drain");
                async move { drained }
            },
            || {
                calls.lock().push("write");
                async move {
                    if write_succeeds {
                        Ok(())
                    } else {
                        anyhow::bail!("the helper refused")
                    }
                }
            },
        )
        .await;
        (calls.into_inner(), result.is_ok())
    }

    #[tokio::test]
    async fn the_service_writes_only_once_the_local_guard_is_gone() {
        assert_eq!(record_service_apply(true, true).await, (vec!["drain", "write"], true));
    }

    #[tokio::test]
    async fn a_write_the_service_refused_is_still_a_failure() {
        assert_eq!(record_service_apply(true, false).await, (vec!["drain", "write"], false));
    }

    #[tokio::test]
    async fn a_local_guard_that_would_not_stop_keeps_root_from_writing() {
        assert_eq!(record_service_apply(false, true).await, (vec!["drain"], false));
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

    use super::{FailedOperation, SysproxyFailure, classify_local_failure};

    fn wrapped_privilege_failure() -> anyhow::Error {
        anyhow::Error::new(sysproxy::Error::RequiresAdminPrivileges).context("failed to apply the system proxy")
    }

    fn classified_privilege_failure() -> anyhow::Error {
        wrapped_privilege_failure().context(SysproxyFailure::PrivilegeRequired)
    }

    #[test]
    fn an_unrelated_failure_is_left_alone() {
        let untouched = classify_local_failure(anyhow::anyhow!("port already in use"));

        assert!(SysproxyFailure::from_chain(&untouched).is_none());
        assert_eq!(format!("{untouched:#}"), "port already in use");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_refusal_wrapped_in_write_progress_is_still_classified() {
        let wrapped = anyhow::Error::new(sysproxy::Error::ProxyWrite {
            progress: sysproxy::WriteProgress::new(0, 7),
            source: Box::new(sysproxy::Error::RequiresAdminPrivileges),
        })
        .context("failed to apply the system proxy");

        let classified = classify_local_failure(wrapped);

        assert!(matches!(
            SysproxyFailure::from_chain(&classified),
            Some(SysproxyFailure::PrivilegeRequired)
        ));
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
    fn only_a_classified_failure_is_worth_recording() {
        let before = crate::core::notification::pending_failures().len();
        assert!(!super::report_failure(
            FailedOperation::SystemProxyRestore,
            &anyhow::anyhow!("port already in use"),
        ));
        assert_eq!(crate::core::notification::pending_failures().len(), before);

        assert!(super::report_failure(
            FailedOperation::SystemProxyRestore,
            &classified_privilege_failure().context("failed to apply system proxy after start"),
        ));

        let recorded = crate::core::notification::pending_failures();
        let failure = recorded
            .iter()
            .find(|failure| failure.code == "SYSPROXY_PRIVILEGE_REQUIRED")
            .unwrap_or_else(|| unreachable!("a classified failure must be recorded"));
        assert!(
            failure.detail.contains("failed to apply system proxy after start"),
            "{failure:?}"
        );
        assert!(failure.detail.contains("admin privileges"), "{failure:?}");
    }

    #[test]
    fn a_refusal_only_blames_the_sidecar_when_a_probe_actually_answered() {
        use super::refusal_classification;

        assert_eq!(
            refusal_classification(Some(true)),
            SysproxyFailure::SidecarWhileServiceReady
        );
        assert_eq!(refusal_classification(Some(false)), SysproxyFailure::PrivilegeRequired);
        assert_eq!(refusal_classification(None), SysproxyFailure::PrivilegeRequired);
    }

    use super::{SystemProxyStateUnknown, is_reportable_given, rollback_failure};

    fn mappable() -> anyhow::Error {
        anyhow::anyhow!("networksetup refused").context(SysproxyFailure::PrivilegeRequired)
    }

    fn record_settlement(effect: super::TableEffect<'_>) -> Vec<String> {
        let events = Mutex::new(Vec::new());
        super::settle_table(
            effect,
            |enabled| events.lock().push(format!("retire:{enabled}")),
            |operation, _| events.lock().push(format!("file:{operation:?}")),
        );
        events.into_inner()
    }

    #[test]
    fn each_effect_reaches_the_table_it_names() {
        assert_eq!(
            record_settlement(super::TableEffect::Retire { enabled: true }),
            vec!["retire:true"]
        );
        assert_eq!(
            record_settlement(super::TableEffect::File(
                FailedOperation::SystemProxyRestore,
                &mappable()
            )),
            vec!["file:SystemProxyRestore"]
        );
        assert!(record_settlement(super::TableEffect::Nothing).is_empty());
    }

    #[test]
    fn a_clear_files_its_failure_and_says_nothing_when_it_works() {
        assert!(matches!(
            super::clear_table_effect(&Err(mappable())),
            super::TableEffect::File(FailedOperation::SystemProxyRestore, _)
        ));
        assert!(matches!(
            super::clear_table_effect(&Ok(())),
            super::TableEffect::Nothing
        ));
        assert!(matches!(
            super::clear_table_effect(&Err(anyhow::anyhow!("the core was already gone"))),
            super::TableEffect::Nothing
        ));
    }

    #[test]
    fn a_clean_apply_retires_in_the_direction_it_reached() {
        assert!(matches!(
            super::table_effect(&Ok(()), true),
            super::TableEffect::Retire { enabled: true }
        ));
        assert!(matches!(
            super::table_effect(&Ok(()), false),
            super::TableEffect::Retire { enabled: false }
        ));
    }

    #[tokio::test]
    async fn a_failure_is_filed_as_whatever_the_caller_declared() {
        let (applied, cleared) = super::notification::asking_for(FailedOperation::SystemProxyEnable, async {
            let (apply_error, clear_error) = (mappable(), mappable());
            (
                format!("{:?}", super::table_effect(&Err(apply_error), true)),
                format!("{:?}", super::clear_table_effect(&Err(clear_error))),
            )
        })
        .await;

        assert!(applied.contains("File(SystemProxyEnable"), "{applied}");
        assert!(cleared.contains("File(SystemProxyEnable"), "{cleared}");
    }

    #[test]
    fn telling_the_user_to_look_needs_something_there_to_find() {
        assert!(is_reportable_given(&mappable(), |_| true));
        assert!(!is_reportable_given(&mappable(), |_| false));
        assert!(!is_reportable_given(&anyhow::anyhow!("the core exited"), |_| true));
    }

    #[test]
    fn a_failure_with_nothing_to_say_is_not_filed() {
        assert!(matches!(
            super::table_effect(&Err(anyhow::anyhow!("the core exited immediately")), true),
            super::TableEffect::Nothing
        ));
    }

    #[test]
    fn a_rollback_that_can_be_explained_becomes_the_source() {
        let combined = rollback_failure(anyhow::anyhow!("could not write the file"), mappable());

        assert!(SysproxyFailure::from_chain(&combined).is_some());
        assert!(format!("{combined:#}").contains("could not write the file"));
    }

    #[test]
    fn the_causing_error_stays_the_source_when_it_is_the_one_that_can_be_explained() {
        let combined = rollback_failure(mappable(), anyhow::anyhow!("could not restore the file"));

        assert!(matches!(
            SysproxyFailure::from_chain(&combined),
            Some(SysproxyFailure::PrivilegeRequired)
        ));
        assert!(format!("{combined:#}").contains("could not restore the file"));
    }

    #[test]
    fn a_state_marker_does_not_outrank_a_code_but_is_not_lost_to_it() {
        let combined = rollback_failure(
            anyhow::anyhow!("half applied").context(SystemProxyStateUnknown),
            mappable(),
        );

        assert!(SysproxyFailure::from_chain(&combined).is_some());
        assert!(SystemProxyStateUnknown::is_in(&combined));
    }

    #[test]
    fn a_state_marker_on_the_source_is_left_where_it_is() {
        let combined = rollback_failure(
            mappable().context(SystemProxyStateUnknown),
            anyhow::anyhow!("could not restore the file"),
        );

        assert!(SystemProxyStateUnknown::is_in(&combined));
        assert!(SysproxyFailure::from_chain(&combined).is_some());
    }

    #[test]
    fn with_both_mappable_the_causing_error_wins() {
        let combined = rollback_failure(
            mappable(),
            anyhow::anyhow!("the service could not set it").context(SysproxyFailure::DirectFallback {
                detail: "fell back to direct".to_owned(),
            }),
        );

        assert!(matches!(
            SysproxyFailure::from_chain(&combined),
            Some(SysproxyFailure::PrivilegeRequired)
        ));
        assert!(format!("{combined:#}").contains("fell back to direct"));
    }

    #[test]
    fn with_neither_mappable_the_causing_error_is_kept() {
        let combined = rollback_failure(anyhow::anyhow!("persisting failed"), anyhow::anyhow!("rollback failed"));

        assert!(SysproxyFailure::from_chain(&combined).is_none());
        assert_eq!(
            format!("{combined:#}"),
            "the rollback that followed also failed: rollback failed: persisting failed"
        );
    }

    #[test]
    fn a_disable_that_ended_up_direct_is_what_was_asked_for() {
        let outcome = ProxyApplyOutcome::DirectFallback {
            message: "first attempt failed".to_owned(),
        };

        assert!(super::service_apply_result(&MacosProxyConfig::Disabled, outcome).is_ok());
    }

    #[test]
    fn a_direct_fallback_reports_that_traffic_may_be_going_direct() {
        let outcome = ProxyApplyOutcome::DirectFallback {
            message: "service could not set the proxy".to_owned(),
        };

        let error = super::service_apply_result(&guarded_proxy(), outcome)
            .err()
            .unwrap_or_else(|| anyhow::anyhow!("a fallback outcome must be reported as a failure"));

        assert_eq!(
            SysproxyFailure::from_chain(&error).map(SysproxyFailure::code),
            Some("SYSPROXY_DIRECT_FALLBACK")
        );
        assert!(format!("{error:#}").contains("service could not set the proxy"));
    }
}

use super::{CoreManager, RunningMode};
use crate::config::{Config, IVerge};
use crate::core::handle::Handle;
use crate::core::manager::CLASH_LOGGER;
use crate::core::proxy_control;
use crate::core::service::{SERVICE_MANAGER, ServiceStatus};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
use smartstring::alias::String;
use std::path::Path;
use tauri_plugin_clash_verge_sysinfo;
#[cfg(target_os = "windows")]
use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;

#[cfg(any(target_os = "windows", test))]
const fn should_wait_for_service(tun_enabled: bool, service_ready: bool, is_admin: bool) -> bool {
    tun_enabled && !service_ready && !is_admin
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupDecision {
    Service,
    Sidecar,
    Wait,
}

const fn startup_decision(status: &ServiceStatus, service_required: bool) -> StartupDecision {
    match status {
        ServiceStatus::Ready => StartupDecision::Service,
        ServiceStatus::NotInstalled if !service_required => StartupDecision::Sidecar,
        ServiceStatus::SidecarAllowed => StartupDecision::Sidecar,
        ServiceStatus::Checking
        | ServiceStatus::NotInstalled
        | ServiceStatus::NeedsReinstall
        | ServiceStatus::InstallRequired
        | ServiceStatus::Unavailable(_) => StartupDecision::Wait,
        ServiceStatus::UninstallRequired | ServiceStatus::ReinstallRequired | ServiceStatus::ForceReinstallRequired => {
            StartupDecision::Wait
        }
    }
}

const fn can_allow_sidecar_for_session(running_mode: &RunningMode, service_status: &ServiceStatus) -> bool {
    matches!(
        (running_mode, service_status),
        (
            RunningMode::NotRunning,
            ServiceStatus::NotInstalled
                | ServiceStatus::NeedsReinstall
                | ServiceStatus::InstallRequired
                | ServiceStatus::Unavailable(_)
        ) | (RunningMode::Sidecar, ServiceStatus::InstallRequired)
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProxyRestoreExpectation {
    mode: RunningMode,
    core_readiness_generation: u64,
    service_owner_generation: Option<u64>,
}

impl ProxyRestoreExpectation {
    const fn capture(
        mode: RunningMode,
        core_readiness_generation: Option<u64>,
        service_owner_generation: u64,
    ) -> Option<Self> {
        let Some(core_readiness_generation) = core_readiness_generation else {
            return None;
        };
        match mode {
            RunningMode::Service => Some(Self {
                mode,
                core_readiness_generation,
                service_owner_generation: Some(service_owner_generation),
            }),
            RunningMode::Sidecar => Some(Self {
                mode,
                core_readiness_generation,
                service_owner_generation: None,
            }),
            RunningMode::NotRunning => None,
        }
    }

    fn is_valid(
        self,
        current_mode: &RunningMode,
        current_core_readiness_generation: Option<u64>,
        current_service_owner_generation: u64,
    ) -> bool {
        self.mode == *current_mode
            && Some(self.core_readiness_generation) == current_core_readiness_generation
            && self
                .service_owner_generation
                .is_none_or(|expected| expected == current_service_owner_generation)
    }
}

async fn run_controlled_stop_transition<StopGuard, StopGuardFuture, Clear, ClearFuture, Stop, StopFuture>(
    is_macos: bool,
    running_mode: RunningMode,
    stop_guard: StopGuard,
    clear_proxy: Clear,
    stop_core: Stop,
) -> Result<()>
where
    StopGuard: FnOnce() -> StopGuardFuture,
    StopGuardFuture: std::future::Future<Output = ()>,
    Clear: FnOnce() -> ClearFuture,
    ClearFuture: std::future::Future<Output = Result<()>>,
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = Result<()>>,
{
    match running_mode {
        RunningMode::NotRunning => {}
        RunningMode::Service if is_macos => stop_guard().await,
        RunningMode::Service | RunningMode::Sidecar => clear_proxy().await?,
    }
    stop_core().await
}

async fn run_core_start_transition<Start, StartFuture, Ready, Apply, ApplyFuture>(
    start_core: Start,
    core_is_ready: Ready,
    apply_proxy: Apply,
) -> Result<()>
where
    Start: FnOnce() -> StartFuture,
    StartFuture: std::future::Future<Output = Result<()>>,
    Ready: FnOnce() -> bool,
    Apply: FnOnce() -> ApplyFuture,
    ApplyFuture: std::future::Future<Output = Result<()>>,
{
    start_core().await?;
    if core_is_ready() {
        apply_proxy().await?;
    }
    Ok(())
}

async fn run_ready_core_start_transition<Start, StartFuture, Ready, Apply, ApplyFuture>(
    start_core: Start,
    core_is_ready: Ready,
    apply_proxy: Apply,
) -> Result<()>
where
    Start: FnOnce() -> StartFuture,
    StartFuture: std::future::Future<Output = Result<()>>,
    Ready: FnOnce() -> bool,
    Apply: FnOnce() -> ApplyFuture,
    ApplyFuture: std::future::Future<Output = Result<()>>,
{
    start_core().await?;
    if !core_is_ready() {
        anyhow::bail!("core did not become ready after start");
    }
    apply_proxy().await
}

async fn run_sidecar_termination_transition<Clear, ClearFuture, Terminate>(
    clear_proxy: Clear,
    terminate_sidecar: Terminate,
) -> Result<()>
where
    Clear: FnOnce() -> ClearFuture,
    ClearFuture: std::future::Future<Output = Result<()>>,
    Terminate: FnOnce(),
{
    clear_proxy().await?;
    terminate_sidecar();
    Ok(())
}

async fn run_service_config_replacement_transition<
    StopGuard,
    StopGuardFuture,
    Clear,
    ClearFuture,
    Stop,
    StopFuture,
    Start,
    StartFuture,
    Ready,
    Restore,
    RestoreFuture,
>(
    is_macos: bool,
    stop_guard: StopGuard,
    clear_proxy: Clear,
    stop_core: Stop,
    start_core: Start,
    core_is_ready: Ready,
    restore_proxy: Restore,
) -> Result<()>
where
    StopGuard: FnOnce() -> StopGuardFuture,
    StopGuardFuture: std::future::Future<Output = ()>,
    Clear: FnOnce() -> ClearFuture,
    ClearFuture: std::future::Future<Output = Result<()>>,
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = Result<()>>,
    Start: FnOnce() -> StartFuture,
    StartFuture: std::future::Future<Output = Result<()>>,
    Ready: FnOnce() -> bool,
    Restore: FnOnce() -> RestoreFuture,
    RestoreFuture: std::future::Future<Output = Result<()>>,
{
    run_controlled_stop_transition(is_macos, RunningMode::Service, stop_guard, clear_proxy, stop_core).await?;
    run_ready_core_start_transition(start_core, core_is_ready, restore_proxy).await
}

pub(super) async fn run_core_replacement_transition<Stop, StopFuture, Start, StartFuture, Restore, RestoreFuture>(
    stop_core: Stop,
    start_core: Start,
    restore_proxy: Restore,
) -> Result<()>
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = Result<()>>,
    Start: FnOnce() -> StartFuture,
    StartFuture: std::future::Future<Output = Result<()>>,
    Restore: FnOnce() -> RestoreFuture,
    RestoreFuture: std::future::Future<Output = Result<()>>,
{
    stop_core().await?;
    start_core().await?;
    restore_proxy().await
}

async fn run_uninstall_transition<Uninstall, UninstallFuture, Prepare, PrepareFuture, Start, StartFuture>(
    uninstall: Uninstall,
    prepare_sidecar: Prepare,
    start_sidecar: Start,
) -> Result<()>
where
    Uninstall: FnOnce() -> UninstallFuture,
    UninstallFuture: std::future::Future<Output = Result<()>>,
    Prepare: FnOnce() -> PrepareFuture,
    PrepareFuture: std::future::Future<Output = Result<()>>,
    Start: FnOnce() -> StartFuture,
    StartFuture: std::future::Future<Output = Result<()>>,
{
    uninstall().await?;
    prepare_sidecar().await?;
    start_sidecar().await
}

/// sidecar→service 交接结果
#[cfg(target_os = "windows")]
enum HandoffOutcome {
    /// 服务尚未就绪
    NotReady,
    /// 已完成或无需交接
    Done,
    /// 交接失败并已回退
    Failed,
}

impl CoreManager {
    async fn rollback_failed_start(&self) {
        proxy_control::stop_guard().await;
        crate::utils::server::set_pac_available(false);
        self.invalidate_core_readiness();
        self.set_running_mode(RunningMode::NotRunning);
    }

    pub async fn start_core(&self) -> Result<()> {
        let _life = self.lifecycle_lock.lock().await;
        run_core_start_transition(
            || self.start_core_inner(),
            || !matches!(*self.get_running_mode(), RunningMode::NotRunning),
            || self.apply_proxy_after_start(),
        )
        .await
    }

    pub async fn continue_with_sidecar(&self) -> Result<()> {
        if !self.try_start_config_update() {
            anyhow::bail!("configuration update is already running");
        }
        defer! {
            self.finish_config_update();
        }
        let _life = self.lifecycle_lock.lock().await;
        let status = SERVICE_MANAGER.current().await;
        let mode = self.get_running_mode();
        if !can_allow_sidecar_for_session(&mode, &status) {
            anyhow::bail!("Sidecar continuation is not allowed from {mode:?} / {status:?}");
        }
        proxy_control::stop_guard().await;
        Config::suppress_tun_for_session().await;
        Config::generate().await?;
        SERVICE_MANAGER.allow_sidecar_for_session()?;
        let result = async {
            self.start_core_inner().await?;
            if !matches!(*self.get_running_mode(), RunningMode::Sidecar) {
                anyhow::bail!("Sidecar did not become ready");
            }
            self.apply_proxy_after_start().await
        }
        .await;
        if let Err(error) = &result {
            SERVICE_MANAGER.mark_unavailable(format!("Sidecar startup failed: {error:#}"));
            if let Err(cleanup_error) = self.rollback_failed_sidecar_transition().await {
                return Err(anyhow::anyhow!(
                    "Sidecar startup failed: {error:#}; failed to clear proxy before rollback: {cleanup_error:#}"
                ));
            }
        }
        result
    }

    pub async fn uninstall_service_and_start_sidecar(&self) -> Result<()> {
        if !self.try_start_config_update() {
            anyhow::bail!("configuration update is already running");
        }
        defer! {
            self.finish_config_update();
        }
        let _life = self.lifecycle_lock.lock().await;

        self.controlled_stop_core_inner().await?;

        let result = run_uninstall_transition(
            || async {
                SERVICE_MANAGER
                    .handle_service_status(ServiceStatus::UninstallRequired)
                    .await
            },
            || async {
                Config::disable_tun_and_persist().await?;
                Config::generate().await
            },
            || async {
                self.start_core_inner().await?;
                if !matches!(*self.get_running_mode(), RunningMode::Sidecar) {
                    anyhow::bail!("Sidecar did not become ready after service uninstall");
                }
                self.apply_proxy_after_start().await
            },
        )
        .await;

        if let Err(error) = &result
            && let Err(cleanup_error) = self.rollback_failed_sidecar_transition().await
        {
            return Err(anyhow::anyhow!(
                "Service uninstall transition failed: {error:#}; failed to clear proxy before rollback: {cleanup_error:#}"
            ));
        }
        result
    }

    async fn rollback_failed_sidecar_transition(&self) -> Result<()> {
        if matches!(*self.get_running_mode(), RunningMode::Sidecar) {
            self.stop_sidecar_after_proxy_clear().await?;
        }
        self.rollback_failed_start().await;
        self.after_core_process();
        Ok(())
    }

    async fn stop_sidecar_after_proxy_clear(&self) -> Result<()> {
        run_sidecar_termination_transition(proxy_control::clear, || self.stop_core_by_sidecar_unprepared()).await
    }

    /// Replaces a Service-owned core while the caller holds `lifecycle_lock`.
    pub(super) async fn replace_service_core_with_config(&self, config_file: &Path) -> Result<()> {
        let result = run_service_config_replacement_transition(
            cfg!(target_os = "macos"),
            proxy_control::stop_guard,
            proxy_control::clear,
            || self.stop_core_unprepared_inner(),
            || self.start_core_by_service_with_config(config_file),
            || {
                matches!(*self.get_running_mode(), RunningMode::Service)
                    && self.current_core_readiness_generation().is_some()
            },
            || self.apply_proxy_after_start(),
        )
        .await;
        self.after_core_process();
        result
    }

    pub(crate) async fn apply_proxy_after_start(&self) -> Result<()> {
        let expectation = ProxyRestoreExpectation::capture(
            *self.get_running_mode(),
            self.current_core_readiness_generation(),
            crate::core::service::owner_monitor_generation(),
        )
        .ok_or_else(|| anyhow::anyhow!("cannot apply system proxy before core readiness"))?;
        proxy_control::apply().await?;
        if !expectation.is_valid(
            self.get_running_mode().as_ref(),
            self.current_core_readiness_generation(),
            crate::core::service::owner_monitor_generation(),
        ) {
            let clear_result = proxy_control::clear().await;
            proxy_control::stop_guard().await;
            clear_result?;
            anyhow::bail!("core readiness changed while applying system proxy");
        }
        proxy_control::refresh_guard().await?;
        if !expectation.is_valid(
            self.get_running_mode().as_ref(),
            self.current_core_readiness_generation(),
            crate::core::service::owner_monitor_generation(),
        ) {
            let clear_result = proxy_control::clear().await;
            proxy_control::stop_guard().await;
            clear_result?;
            anyhow::bail!("core readiness changed while refreshing the system proxy guard");
        }
        Ok(())
    }

    /// 调用者须已持有 `lifecycle_lock`。
    async fn start_core_inner(&self) -> Result<()> {
        // 退出中不再启动新内核。
        if Handle::global().is_exiting() {
            return Ok(());
        }

        // 已有内核运行时保持幂等,重启请走 restart_core。
        if !matches!(*self.get_running_mode(), RunningMode::NotRunning) {
            logging!(
                info,
                Type::Core,
                "start_core called while a core is running; treated as no-op"
            );
            return Ok(());
        }

        let startup = self.prepare_startup().await;
        if matches!(startup, StartupDecision::Wait) {
            self.rollback_failed_start().await;
            self.after_core_process();
            return Ok(());
        }
        defer! {
            self.after_core_process();
        }

        // 等待服务期间可能进入退出;未真正启动时回滚状态。
        if Handle::global().is_exiting() {
            self.set_running_mode(RunningMode::NotRunning);
            return Ok(());
        }

        let result = match startup {
            StartupDecision::Service => self.start_core_by_service().await,
            StartupDecision::Sidecar => self.start_core_by_sidecar().await,
            StartupDecision::Wait => Ok(()),
        };

        // No startup failure may leave a locally reported running mode. PAC is
        // still fail-closed, and any service owner monitor will exit after this
        // transition instead of treating an unconfirmed core as running.
        if result.is_err() {
            self.rollback_failed_start().await;
            return result;
        }

        // 回退 sidecar 后,后台等待服务就绪再交接
        #[cfg(target_os = "windows")]
        if matches!(*self.get_running_mode(), RunningMode::Sidecar) {
            self.spawn_service_handoff_watcher().await;
        }

        result
    }

    pub async fn stop_core(&self) -> Result<()> {
        let _life = self.lifecycle_lock.lock().await;
        self.controlled_stop_core_inner().await
    }

    /// 调用者须已持有 `lifecycle_lock`。
    pub(crate) async fn controlled_stop_core_inner(&self) -> Result<()> {
        let running_mode = *self.get_running_mode();
        run_controlled_stop_transition(
            cfg!(target_os = "macos"),
            running_mode,
            proxy_control::stop_guard,
            proxy_control::clear,
            || self.stop_core_unprepared_inner(),
        )
        .await
    }

    /// 调用者须已持有 `lifecycle_lock`,且已完成受控代理清理。
    async fn stop_core_unprepared_inner(&self) -> Result<()> {
        CLASH_LOGGER.clear_logs().await;
        defer! {
            self.after_core_process();
        }

        match *self.get_running_mode() {
            RunningMode::Service => self.stop_core_by_service().await,
            RunningMode::Sidecar => {
                self.stop_core_by_sidecar_unprepared();
                Ok(())
            }
            RunningMode::NotRunning => Ok(()),
        }
    }

    pub async fn restart_core(&self) -> Result<()> {
        // 持锁覆盖 stop+start,避免生命周期操作插入。
        let _life = self.lifecycle_lock.lock().await;
        logging!(info, Type::Core, "Restarting core");
        run_core_replacement_transition(
            || self.controlled_stop_core_inner(),
            || async {
                self.start_core_inner().await?;
                if matches!(*self.get_running_mode(), RunningMode::NotRunning) {
                    anyhow::bail!("core did not become ready after restart");
                }
                Ok(())
            },
            || self.apply_proxy_after_start(),
        )
        .await
    }

    pub async fn change_core(&self, clash_core: &String) -> Result<(), String> {
        if !IVerge::VALID_CLASH_CORES.contains(&clash_core.as_str()) {
            return Err(format!("Invalid clash core: {}", clash_core).into());
        }

        let old_core = Config::verge().await.latest_arc().clash_core.clone();

        // 校验器基于已 apply 的配置生成，须先切到新内核
        Config::verge().await.edit_draft(|d| {
            d.clash_core = Some(clash_core.to_owned());
        });
        Config::verge().await.apply();

        // 校验通过才落盘；失败回滚内存态，避免下次启动带着坏内核起
        if let Err(e) = self.update_config_checked().await {
            Config::verge().await.edit_draft(|d| {
                d.clash_core = old_core;
            });
            Config::verge().await.apply();
            return Err(e.to_string().into());
        }

        let verge_data = Config::verge().await.latest_arc();
        verge_data.save_file().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn prepare_startup(&self) -> StartupDecision {
        #[cfg(target_os = "windows")]
        self.wait_for_service_if_needed().await;

        let service_required = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false)
            && !Config::tun_suppressed_for_session();
        if service_required
            && matches!(SERVICE_MANAGER.current().await, ServiceStatus::NotInstalled)
            && SERVICE_MANAGER.require_install_for_session().is_err()
        {
            return StartupDecision::Wait;
        }
        startup_decision(&SERVICE_MANAGER.current().await, service_required)
    }

    pub(in crate::core) fn after_core_process(&self) {
        let app_handle = Handle::app_handle();
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, self.get_running_mode().to_string());
    }

    #[cfg(target_os = "windows")]
    async fn wait_for_service_if_needed(&self) {
        use crate::{config::Config, constants::timing};
        use backon::{ConstantBuilder, Retryable as _};

        let tun_enabled = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
        let service_ready = matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready);
        let is_admin = is_current_app_handle_admin(Handle::app_handle());

        if !should_wait_for_service(tun_enabled, service_ready, is_admin) {
            if tun_enabled && !service_ready && is_admin {
                logging!(
                    info,
                    Type::Core,
                    "service unavailable while app is elevated; starting sidecar immediately"
                );
            }
            return;
        }

        let max_times = timing::SERVICE_WAIT_MAX.as_millis() / timing::SERVICE_WAIT_INTERVAL.as_millis();
        let backoff = ConstantBuilder::default()
            .with_delay(timing::SERVICE_WAIT_INTERVAL)
            .with_max_times(max_times as usize);

        let wait_for_ready = (|| async {
            if SERVICE_MANAGER.is_ready_cached() {
                return Ok(());
            }

            // Probe the service directly. A transient transport failure does not overwrite
            // the last confirmed install state and is retried within the startup deadline.
            SERVICE_MANAGER.confirm_ready().await
        })
        .retry(backoff);
        let _ = tokio::time::timeout(timing::SERVICE_WAIT_MAX, wait_for_ready).await;
    }

    /// 在窗口内等待服务就绪,再从 sidecar 交接到 service
    #[cfg(target_os = "windows")]
    async fn spawn_service_handoff_watcher(&self) {
        use crate::constants::timing;
        use crate::process::AsyncHandler;
        use std::sync::atomic::Ordering;
        use std::time::Instant;

        // 仅 TUN 模式需要服务交接
        let needs_service = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false)
            && !Config::tun_suppressed_for_session();
        if !needs_service {
            return;
        }

        // 单实例,避免并发交接
        if self.handoff_watcher_running.swap(true, Ordering::AcqRel) {
            return;
        }

        logging!(
            info,
            Type::Core,
            "service not ready at startup; sidecar active, watching for handoff"
        );

        AsyncHandler::spawn(|| async move {
            let manager = Self::global();
            let started = Instant::now();
            loop {
                if started.elapsed() >= timing::SERVICE_HANDOFF_WINDOW {
                    logging!(
                        info,
                        Type::Core,
                        "service handoff window elapsed; staying in sidecar mode"
                    );
                    break;
                }
                tokio::time::sleep(timing::SERVICE_HANDOFF_INTERVAL).await;

                // 模式已变更时退出
                if !matches!(*manager.get_running_mode(), RunningMode::Sidecar) {
                    break;
                }
                match manager.try_handoff_sidecar_to_service().await {
                    // 已交接或无需交接
                    HandoffOutcome::Done => break,
                    // 已回退 sidecar,停止重试
                    HandoffOutcome::Failed => {
                        logging!(warn, Type::Core, "handoff attempt failed; staying in sidecar mode");
                        break;
                    }
                    HandoffOutcome::NotReady => {}
                }
            }
            manager.handoff_watcher_running.store(false, Ordering::Release);
        });
    }

    #[cfg(target_os = "windows")]
    async fn refresh_service_readiness_for_handoff() -> bool {
        // 主动刷新服务状态,避免缓存状态阻止交接
        if SERVICE_MANAGER.confirm_ready().await.is_err() {
            return false;
        }
        SERVICE_MANAGER.is_ready_cached()
    }

    /// 服务就绪后停止 sidecar,再以 service 重启内核
    #[cfg(target_os = "windows")]
    async fn try_handoff_sidecar_to_service(&self) -> HandoffOutcome {
        if !Self::refresh_service_readiness_for_handoff().await {
            return HandoffOutcome::NotReady;
        }

        // 先抢 config 锁;失败则让位给正在进行的更新。
        if !self.try_start_config_update() {
            return HandoffOutcome::NotReady;
        }
        defer! {
            self.finish_config_update();
        }

        // 再取 lifecycle 锁;锁序固定为 config→lifecycle。
        let _life = self.lifecycle_lock.lock().await;

        // 持锁后复检运行模式和 TUN 状态
        if !matches!(*self.get_running_mode(), RunningMode::Sidecar)
            || !Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false)
            || Config::tun_suppressed_for_session()
        {
            return HandoffOutcome::Done;
        }

        logging!(
            info,
            Type::Core,
            "service became ready; handing off from sidecar to service"
        );
        if let Err(error) = self.stop_sidecar_after_proxy_clear().await {
            logging!(
                error,
                Type::Core,
                "failed to clear proxy before sidecar handoff: {error:#}"
            );
            return HandoffOutcome::Failed;
        }

        let service_result = run_ready_core_start_transition(
            || self.start_core_by_service(),
            || {
                matches!(*self.get_running_mode(), RunningMode::Service)
                    && self.current_core_readiness_generation().is_some()
            },
            || self.apply_proxy_after_start(),
        )
        .await;
        let Err(service_error) = service_result else {
            logging!(info, Type::Core, "handoff to service mode succeeded");
            return HandoffOutcome::Done;
        };

        logging!(error, Type::Core, "handoff to service failed: {service_error:#}");
        if let Err(cleanup_error) = self.controlled_stop_core_inner().await {
            logging!(
                error,
                Type::Core,
                "failed to stop service before sidecar fallback: {cleanup_error:#}"
            );
            return HandoffOutcome::Failed;
        }

        let sidecar_result = run_ready_core_start_transition(
            || self.start_core_by_sidecar(),
            || {
                matches!(*self.get_running_mode(), RunningMode::Sidecar)
                    && self.current_core_readiness_generation().is_some()
            },
            || self.apply_proxy_after_start(),
        )
        .await;
        if let Err(sidecar_error) = sidecar_result {
            logging!(error, Type::Core, "sidecar fallback failed: {sidecar_error:#}");
            if let Err(cleanup_error) = self.rollback_failed_sidecar_transition().await {
                logging!(
                    error,
                    Type::Core,
                    "failed to clear proxy before sidecar rollback: {cleanup_error:#}"
                );
            }
        } else {
            logging!(
                info,
                Type::Core,
                "sidecar fallback became ready and restored proxy state"
            );
        }
        HandoffOutcome::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CoreManager, ProxyRestoreExpectation, StartupDecision, can_allow_sidecar_for_session,
        run_controlled_stop_transition, run_core_replacement_transition, run_core_start_transition,
        run_ready_core_start_transition, run_service_config_replacement_transition, run_sidecar_termination_transition,
        run_uninstall_transition, should_wait_for_service, startup_decision,
    };
    use crate::core::{manager::RunningMode, service::ServiceStatus};
    use parking_lot::Mutex;
    use std::{
        future,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicU64, Ordering},
        },
        task::Poll,
    };
    use tokio::sync::{Barrier, Mutex as AsyncMutex};

    struct FakeGuardCoordinator {
        generation: AtomicU64,
        operation_lock: AsyncMutex<()>,
    }

    impl FakeGuardCoordinator {
        const fn new() -> Self {
            Self {
                generation: AtomicU64::new(1),
                operation_lock: AsyncMutex::const_new(()),
            }
        }

        async fn run_guard_request(&self, captured_generation: u64, calls: &Mutex<Vec<&'static str>>) -> bool {
            let _operation = self.operation_lock.lock().await;
            if self.generation.load(Ordering::Acquire) != captured_generation {
                return false;
            }
            calls.lock().push("guard-reapply");
            true
        }

        async fn stop_guard(&self, calls: &Mutex<Vec<&'static str>>) {
            self.generation.fetch_add(1, Ordering::AcqRel);
            let _operation = self.operation_lock.lock().await;
            calls.lock().push("guard-stopped");
        }
    }

    fn transition_step(
        calls: &Arc<Mutex<Vec<&'static str>>>,
        step: &'static str,
        fail_at: Option<&'static str>,
    ) -> future::Ready<anyhow::Result<()>> {
        calls.lock().push(step);
        future::ready(if fail_at == Some(step) {
            Err(anyhow::anyhow!("{step} failed"))
        } else {
            Ok(())
        })
    }

    #[tokio::test]
    async fn uninstall_transition_is_ordered_and_short_circuits_at_every_failure() {
        let steps = ["uninstall", "prepare-sidecar", "start-sidecar"];

        for fail_at in std::iter::once(None).chain(steps.map(Some)) {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let result = run_uninstall_transition(
                || transition_step(&calls, steps[0], fail_at),
                || transition_step(&calls, steps[1], fail_at),
                || transition_step(&calls, steps[2], fail_at),
            )
            .await;

            let expected_len = fail_at
                .and_then(|failed| steps.iter().position(|step| *step == failed).map(|index| index + 1))
                .unwrap_or(steps.len());
            assert_eq!(&*calls.lock(), &steps[..expected_len]);
            assert_eq!(result.is_err(), fail_at.is_some());
        }
    }

    #[tokio::test]
    async fn controlled_sidecar_stop_clears_proxy_before_stopping() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Sidecar,
            || future::ready(()),
            || transition_step(&calls, "proxy_clear", None),
            || transition_step(&calls, "core_stop", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["proxy_clear", "core_stop"]);
    }

    #[tokio::test]
    async fn controlled_macos_service_stop_drains_guard_before_one_helper_transaction() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Service,
            || {
                calls.lock().push("guard-stopped");
                future::ready(())
            },
            || transition_step(&calls, "unexpected-proxy-clear", None),
            || transition_step(&calls, "service_stop_with_proxy_clear", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["guard-stopped", "service_stop_with_proxy_clear"]);
    }

    #[tokio::test]
    async fn failed_macos_service_stop_cannot_be_followed_by_a_stale_guard_write() {
        let coordinator = Arc::new(FakeGuardCoordinator::new());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let guard_started = Arc::new(Barrier::new(2));
        let release_guard = Arc::new(Barrier::new(2));
        let captured_generation = coordinator.generation.load(Ordering::Acquire);

        let in_flight_guard = {
            let coordinator = Arc::clone(&coordinator);
            let calls = Arc::clone(&calls);
            let guard_started = Arc::clone(&guard_started);
            let release_guard = Arc::clone(&release_guard);
            tokio::spawn(async move {
                let _operation = coordinator.operation_lock.lock().await;
                calls.lock().push("guard-started");
                guard_started.wait().await;
                release_guard.wait().await;
                calls.lock().push("guard-finished");
            })
        };
        guard_started.wait().await;

        let mut stop = Box::pin(run_controlled_stop_transition(
            true,
            RunningMode::Service,
            || async {
                coordinator.stop_guard(&calls).await;
            },
            || transition_step(&calls, "unexpected-proxy-clear", None),
            || transition_step(&calls, "service-stop-failed", Some("service-stop-failed")),
        ));
        assert!(matches!(futures::poll!(stop.as_mut()), Poll::Pending));
        release_guard.wait().await;

        assert!(in_flight_guard.await.is_ok());
        assert!(stop.await.is_err());
        assert!(!coordinator.run_guard_request(captured_generation, &calls).await);
        assert_eq!(
            &*calls.lock(),
            &[
                "guard-started",
                "guard-finished",
                "guard-stopped",
                "service-stop-failed"
            ]
        );
    }

    #[tokio::test]
    async fn controlled_sidecar_stop_aborts_when_proxy_clear_fails() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Sidecar,
            || future::ready(()),
            || transition_step(&calls, "proxy_clear", Some("proxy_clear")),
            || transition_step(&calls, "core_stop", None),
        )
        .await;

        assert!(result.is_err());
        assert_eq!(&*calls.lock(), &["proxy_clear"]);
    }

    #[tokio::test]
    async fn failed_sidecar_transition_rollback_surfaces_clear_failure_without_terminating() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let sidecar_alive = AtomicBool::new(true);

        let result = run_sidecar_termination_transition(
            || transition_step(&calls, "rollback-proxy-clear", Some("rollback-proxy-clear")),
            || {
                sidecar_alive.store(false, Ordering::Release);
                calls.lock().push("rollback-sidecar-stop");
            },
        )
        .await;

        assert!(matches!(
            result,
            Err(error) if error.to_string().contains("rollback-proxy-clear failed")
        ));
        assert!(sidecar_alive.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["rollback-proxy-clear"]);
    }

    #[tokio::test]
    async fn handoff_sidecar_cleanup_is_clear_gated_and_ordered() {
        for fail_at in [None, Some("handoff-proxy-clear")] {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let sidecar_alive = AtomicBool::new(true);

            let result = run_sidecar_termination_transition(
                || transition_step(&calls, "handoff-proxy-clear", fail_at),
                || {
                    sidecar_alive.store(false, Ordering::Release);
                    calls.lock().push("handoff-sidecar-stop");
                },
            )
            .await;

            if fail_at.is_some() {
                assert!(result.is_err());
                assert!(sidecar_alive.load(Ordering::Acquire));
                assert_eq!(&*calls.lock(), &["handoff-proxy-clear"]);
            } else {
                assert!(result.is_ok());
                assert!(!sidecar_alive.load(Ordering::Acquire));
                assert_eq!(&*calls.lock(), &["handoff-proxy-clear", "handoff-sidecar-stop"]);
            }
        }
    }

    #[tokio::test]
    async fn handoff_chosen_core_applies_proxy_only_after_required_readiness() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_ready_core_start_transition(
            || transition_step(&calls, "core-start", None),
            || {
                calls.lock().push("core-ready");
                true
            },
            || transition_step(&calls, "proxy-apply", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["core-start", "core-ready", "proxy-apply"]);
    }

    #[tokio::test]
    async fn handoff_chosen_core_without_readiness_never_applies_proxy() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_ready_core_start_transition(
            || transition_step(&calls, "core-start", None),
            || {
                calls.lock().push("core-not-ready");
                false
            },
            || transition_step(&calls, "unexpected-proxy-apply", None),
        )
        .await;

        assert!(result.is_err());
        assert_eq!(&*calls.lock(), &["core-start", "core-not-ready"]);
    }

    #[tokio::test]
    async fn handoff_cleanup_failure_aborts_fallback_and_leaves_service_alive() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let service_alive = AtomicBool::new(true);

        let result = run_controlled_stop_transition(
            false,
            RunningMode::Service,
            || future::ready(()),
            || transition_step(&calls, "service-proxy-clear", Some("service-proxy-clear")),
            || {
                service_alive.store(false, Ordering::Release);
                transition_step(&calls, "service-stop", None)
            },
        )
        .await;

        assert!(result.is_err());
        assert!(service_alive.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["service-proxy-clear"]);
    }

    #[tokio::test]
    async fn controlled_start_applies_proxy_only_after_core_is_ready() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_core_start_transition(
            || transition_step(&calls, "core_start", None),
            || true,
            || transition_step(&calls, "proxy_apply", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["core_start", "proxy_apply"]);
    }

    #[tokio::test]
    async fn controlled_start_does_not_apply_proxy_without_a_ready_core() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_core_start_transition(
            || transition_step(&calls, "core_start", None),
            || false,
            || transition_step(&calls, "proxy_apply", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["core_start"]);
    }

    #[tokio::test]
    async fn restart_start_failure_keeps_proxy_direct_guard_stopped_and_pac_unavailable() {
        let proxy_is_direct = AtomicBool::new(false);
        let guard_stopped = AtomicBool::new(false);
        let pac_available = AtomicBool::new(true);
        let restored_new_core = AtomicBool::new(false);

        let result = run_core_replacement_transition(
            || {
                proxy_is_direct.store(true, Ordering::Release);
                guard_stopped.store(true, Ordering::Release);
                pac_available.store(false, Ordering::Release);
                future::ready(Ok(()))
            },
            || future::ready(Err(anyhow::anyhow!("new core failed to start"))),
            || {
                restored_new_core.store(true, Ordering::Release);
                future::ready(Ok(()))
            },
        )
        .await;

        assert!(result.is_err());
        assert!(proxy_is_direct.load(Ordering::Acquire));
        assert!(guard_stopped.load(Ordering::Acquire));
        assert!(!pac_available.load(Ordering::Acquire));
        assert!(!restored_new_core.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn service_config_start_failure_uses_the_same_fail_closed_replacement_order() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_core_replacement_transition(
            || transition_step(&calls, "controlled-stop", None),
            || transition_step(&calls, "start-service-config", Some("start-service-config")),
            || transition_step(&calls, "restore-proxy", None),
        )
        .await;

        assert!(result.is_err());
        assert_eq!(&*calls.lock(), &["controlled-stop", "start-service-config"]);
    }

    #[tokio::test]
    async fn service_config_replacement_is_controlled_and_generation_safe_on_every_platform() {
        for is_macos in [false, true] {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let manager = CoreManager::default();
            let old_readiness_generation = manager.mark_core_ready();
            manager.set_running_mode(RunningMode::Service);
            let owner_monitor_generation = AtomicU64::new(1);
            let old_owner_monitor_generation = owner_monitor_generation.load(Ordering::Acquire);

            let result = run_service_config_replacement_transition(
                is_macos,
                || {
                    calls.lock().push("guard-stopped");
                    future::ready(())
                },
                || transition_step(&calls, "proxy-clear", None),
                || {
                    calls.lock().push("helper-stop");
                    owner_monitor_generation.fetch_add(1, Ordering::AcqRel);
                    manager.set_running_mode(RunningMode::NotRunning);
                    future::ready(Ok(()))
                },
                || {
                    calls.lock().push("service-start");
                    owner_monitor_generation.fetch_add(1, Ordering::AcqRel);
                    manager.mark_core_ready();
                    manager.set_running_mode(RunningMode::Service);
                    if owner_monitor_generation
                        .compare_exchange(
                            old_owner_monitor_generation,
                            old_owner_monitor_generation.wrapping_add(1),
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        calls.lock().push("old-monitor-invalidated-readiness");
                        manager.invalidate_core_readiness();
                    } else {
                        calls.lock().push("old-monitor-rejected");
                    }
                    future::ready(Ok(()))
                },
                || {
                    calls.lock().push("readiness-checked");
                    matches!(*manager.get_running_mode(), RunningMode::Service)
                        && manager.current_core_readiness_generation().is_some()
                        && manager.current_core_readiness_generation() != Some(old_readiness_generation)
                },
                || transition_step(&calls, "proxy-apply", None),
            )
            .await;

            assert!(result.is_ok());
            let expected_preparation = if is_macos { "guard-stopped" } else { "proxy-clear" };
            assert_eq!(
                &*calls.lock(),
                &[
                    expected_preparation,
                    "helper-stop",
                    "service-start",
                    "old-monitor-rejected",
                    "readiness-checked",
                    "proxy-apply",
                ]
            );
        }
    }

    #[test]
    fn startup_waits_when_a_service_requirement_cannot_be_satisfied() {
        assert_eq!(startup_decision(&ServiceStatus::Ready, true), StartupDecision::Service);
        assert_eq!(
            startup_decision(&ServiceStatus::NotInstalled, true),
            StartupDecision::Wait
        );
        assert_eq!(
            startup_decision(&ServiceStatus::NotInstalled, false),
            StartupDecision::Sidecar
        );
        assert_eq!(
            startup_decision(&ServiceStatus::SidecarAllowed, true),
            StartupDecision::Sidecar
        );
        assert_eq!(
            startup_decision(&ServiceStatus::NeedsReinstall, true),
            StartupDecision::Wait
        );
        assert_eq!(
            startup_decision(&ServiceStatus::Unavailable("broken".into()), true),
            StartupDecision::Wait
        );
        assert_eq!(startup_decision(&ServiceStatus::Checking, true), StartupDecision::Wait);
    }

    #[test]
    fn service_evidence_failures_never_silently_fall_back() {
        assert_eq!(
            startup_decision(&ServiceStatus::NeedsReinstall, false),
            StartupDecision::Wait
        );
        assert_eq!(
            startup_decision(&ServiceStatus::Unavailable("missing".into()), false),
            StartupDecision::Wait
        );
    }

    #[test]
    fn service_wait_is_only_required_for_non_admin_tun() {
        assert!(should_wait_for_service(true, false, false));
        assert!(!should_wait_for_service(true, false, true));
        assert!(!should_wait_for_service(true, true, false));
        assert!(!should_wait_for_service(false, false, false));
    }

    #[test]
    fn sidecar_session_allowance_is_cross_platform_and_explicit() {
        let allowed_statuses = [
            ServiceStatus::NotInstalled,
            ServiceStatus::NeedsReinstall,
            ServiceStatus::InstallRequired,
            ServiceStatus::Unavailable("offline".into()),
        ];
        for status in &allowed_statuses {
            assert!(can_allow_sidecar_for_session(&RunningMode::NotRunning, status));
            assert!(!can_allow_sidecar_for_session(&RunningMode::Service, status));
            if !matches!(status, ServiceStatus::InstallRequired) {
                assert!(!can_allow_sidecar_for_session(&RunningMode::Sidecar, status));
            }
        }

        let rejected_statuses = [
            ServiceStatus::Checking,
            ServiceStatus::Ready,
            ServiceStatus::UninstallRequired,
            ServiceStatus::ReinstallRequired,
            ServiceStatus::ForceReinstallRequired,
            ServiceStatus::SidecarAllowed,
        ];
        for status in &rejected_statuses {
            assert!(!can_allow_sidecar_for_session(&RunningMode::NotRunning, status));
        }
    }

    #[test]
    fn failed_service_install_can_continue_with_an_existing_sidecar() {
        assert!(can_allow_sidecar_for_session(
            &RunningMode::Sidecar,
            &ServiceStatus::InstallRequired,
        ));
    }

    #[test]
    fn proxy_restore_requires_the_same_ready_core_generation() {
        let sidecar =
            ProxyRestoreExpectation::capture(RunningMode::Sidecar, Some(20), 8).unwrap_or_else(|| unreachable!());
        assert!(sidecar.is_valid(&RunningMode::Sidecar, Some(20), 8));
        assert!(!sidecar.is_valid(&RunningMode::Sidecar, Some(21), 8));
        assert!(!sidecar.is_valid(&RunningMode::Sidecar, None, 8));
        assert!(ProxyRestoreExpectation::capture(RunningMode::Sidecar, None, 8).is_none());

        let service =
            ProxyRestoreExpectation::capture(RunningMode::Service, Some(20), 8).unwrap_or_else(|| unreachable!());
        assert!(service.is_valid(&RunningMode::Service, Some(20), 8));
        assert!(!service.is_valid(&RunningMode::Service, Some(20), 9));
        assert!(!service.is_valid(&RunningMode::NotRunning, Some(20), 8));
        assert!(ProxyRestoreExpectation::capture(RunningMode::Service, None, 8).is_none());
        assert!(ProxyRestoreExpectation::capture(RunningMode::NotRunning, Some(20), 8).is_none());
    }

    #[tokio::test]
    async fn failed_start_rolls_back_even_from_service_mode() {
        let manager = CoreManager::default();
        manager.set_running_mode(RunningMode::Service);
        manager.rollback_failed_start().await;
        assert_eq!(*manager.get_running_mode(), RunningMode::NotRunning);

        manager.set_running_mode(RunningMode::Sidecar);
        manager.rollback_failed_start().await;
        assert_eq!(*manager.get_running_mode(), RunningMode::NotRunning);
    }
}

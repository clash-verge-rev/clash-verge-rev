use super::{CoreManager, RunningMode};
use crate::cmd::StringifyErr as _;
use crate::config::{Config, IVerge};
use crate::core::handle::Handle;
use crate::core::manager::CLASH_LOGGER;
use crate::core::service::{SERVICE_MANAGER, ServiceStatus};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
use smartstring::alias::String;
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

const fn startup_decision(status: &ServiceStatus, block_on_service_issue: bool) -> StartupDecision {
    match status {
        ServiceStatus::Ready => StartupDecision::Service,
        ServiceStatus::Checking | ServiceStatus::NeedsReinstall | ServiceStatus::Unavailable(_)
            if block_on_service_issue =>
        {
            StartupDecision::Wait
        }
        _ => StartupDecision::Sidecar,
    }
}

const fn can_allow_sidecar_for_session(
    is_macos: bool,
    running_mode: &RunningMode,
    service_status: &ServiceStatus,
) -> bool {
    is_macos
        && matches!(running_mode, RunningMode::NotRunning)
        && matches!(
            service_status,
            ServiceStatus::NeedsReinstall | ServiceStatus::Unavailable(_)
        )
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
    fn rollback_failed_start(&self) {
        crate::core::sysopt::Sysopt::global().stop_proxy_guard();
        crate::utils::server::set_pac_available(false);
        self.set_running_mode(RunningMode::NotRunning);
    }

    pub async fn start_core(&self) -> Result<()> {
        let _life = self.lifecycle_lock.lock().await;
        self.start_core_inner().await
    }

    pub async fn continue_with_sidecar(&self) -> Result<()> {
        let _life = self.lifecycle_lock.lock().await;
        let status = SERVICE_MANAGER.current().await;
        let mode = self.get_running_mode();
        if !can_allow_sidecar_for_session(cfg!(target_os = "macos"), &mode, &status) {
            anyhow::bail!("Sidecar continuation is not allowed from {mode:?} / {status:?}");
        }
        SERVICE_MANAGER.allow_sidecar_for_session()?;
        self.start_core_inner().await
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
            self.rollback_failed_start();
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
            self.rollback_failed_start();
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
        self.stop_core_inner().await
    }

    /// 调用者须已持有 `lifecycle_lock`。
    async fn stop_core_inner(&self) -> Result<()> {
        CLASH_LOGGER.clear_logs().await;
        defer! {
            self.after_core_process();
        }

        match *self.get_running_mode() {
            RunningMode::Service => self.stop_core_by_service().await,
            RunningMode::Sidecar => {
                self.stop_core_by_sidecar();
                Ok(())
            }
            RunningMode::NotRunning => Ok(()),
        }
    }

    pub async fn restart_core(&self) -> Result<()> {
        // 持锁覆盖 stop+start,避免生命周期操作插入。
        let _life = self.lifecycle_lock.lock().await;
        logging!(info, Type::Core, "Restarting core");
        self.stop_core_inner().await?;
        self.start_core_inner().await
    }

    pub async fn change_core(&self, clash_core: &String) -> Result<(), String> {
        if !IVerge::VALID_CLASH_CORES.contains(&clash_core.as_str()) {
            return Err(format!("Invalid clash core: {}", clash_core).into());
        }

        Config::verge().await.edit_draft(|d| {
            d.clash_core = Some(clash_core.to_owned());
        });
        Config::verge().await.apply();

        let verge_data = Config::verge().await.latest_arc();
        verge_data.save_file().await.map_err(|e| e.to_string())?;

        self.update_config_checked().await.stringify_err()?;
        Ok(())
    }

    async fn prepare_startup(&self) -> StartupDecision {
        #[cfg(target_os = "windows")]
        self.wait_for_service_if_needed().await;

        startup_decision(&SERVICE_MANAGER.current().await, cfg!(target_os = "macos"))
    }

    pub(in crate::core) fn after_core_process(&self) {
        let app_handle = Handle::app_handle();
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, self.get_running_mode().to_string());
    }

    #[cfg(target_os = "windows")]
    async fn wait_for_service_if_needed(&self) {
        use crate::{config::Config, constants::timing, core::service};
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

        let _ = (|| async {
            if matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
                return Ok(());
            }

            // If the service IPC path is not ready yet, treat it as transient and retry.
            // Running init/refresh too early can mark service state unavailable and break later config reloads.
            if !service::is_service_ipc_path_exists() {
                return Err(anyhow::anyhow!("Service IPC not ready"));
            }

            SERVICE_MANAGER.init().await?;
            let _ = SERVICE_MANAGER.refresh().await;

            if matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
                Ok(())
            } else {
                Err(anyhow::anyhow!("Service not ready"))
            }
        })
        .retry(backoff)
        .await;
    }

    /// 在窗口内等待服务就绪,再从 sidecar 交接到 service
    #[cfg(target_os = "windows")]
    async fn spawn_service_handoff_watcher(&self) {
        use crate::constants::timing;
        use crate::process::AsyncHandler;
        use std::sync::atomic::Ordering;
        use std::time::Instant;

        // 仅 TUN 模式需要服务交接
        let needs_service = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
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

    /// 服务就绪后停止 sidecar,再以 service 重启内核
    #[cfg(target_os = "windows")]
    async fn try_handoff_sidecar_to_service(&self) -> HandoffOutcome {
        use crate::core::service;

        // 主动刷新服务状态,避免缓存状态阻止交接
        if !service::is_service_ipc_path_exists() {
            return HandoffOutcome::NotReady;
        }
        if SERVICE_MANAGER.init().await.is_err() {
            return HandoffOutcome::NotReady;
        }
        let _ = SERVICE_MANAGER.refresh().await;
        if !matches!(SERVICE_MANAGER.current().await, ServiceStatus::Ready) {
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
        {
            return HandoffOutcome::Done;
        }

        logging!(
            info,
            Type::Core,
            "service became ready; handing off from sidecar to service"
        );
        self.stop_core_by_sidecar();

        match self.start_core_by_service().await {
            Ok(()) => {
                logging!(info, Type::Core, "handoff to service mode succeeded");
                HandoffOutcome::Done
            }
            Err(e) => {
                logging!(
                    error,
                    Type::Core,
                    "handoff to service failed: {}; restarting sidecar",
                    e
                );
                if let Err(e2) = self.start_core_by_sidecar().await {
                    logging!(
                        error,
                        Type::Core,
                        "failed to restart sidecar after handoff failure: {}",
                        e2
                    );
                }
                HandoffOutcome::Failed
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CoreManager, StartupDecision, can_allow_sidecar_for_session, should_wait_for_service, startup_decision,
    };
    use crate::core::{manager::RunningMode, service::ServiceStatus};

    #[test]
    fn macos_waits_for_reinstall_decision_but_missing_service_uses_sidecar() {
        assert_eq!(startup_decision(&ServiceStatus::Ready, true), StartupDecision::Service);
        assert_eq!(
            startup_decision(&ServiceStatus::NotInstalled, true),
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
    fn non_macos_keeps_existing_sidecar_fallback() {
        assert_eq!(
            startup_decision(&ServiceStatus::NeedsReinstall, false),
            StartupDecision::Sidecar
        );
        assert_eq!(
            startup_decision(&ServiceStatus::Unavailable("missing".into()), false),
            StartupDecision::Sidecar
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
    fn sidecar_session_allowance_is_macos_only_not_running_and_migration_only() {
        let allowed_statuses = [
            ServiceStatus::NeedsReinstall,
            ServiceStatus::Unavailable("offline".into()),
        ];
        for status in &allowed_statuses {
            assert!(can_allow_sidecar_for_session(true, &RunningMode::NotRunning, status));
            assert!(!can_allow_sidecar_for_session(false, &RunningMode::NotRunning, status));
            assert!(!can_allow_sidecar_for_session(true, &RunningMode::Service, status));
            assert!(!can_allow_sidecar_for_session(true, &RunningMode::Sidecar, status));
        }

        let rejected_statuses = [
            ServiceStatus::Checking,
            ServiceStatus::Ready,
            ServiceStatus::NotInstalled,
            ServiceStatus::InstallRequired,
            ServiceStatus::UninstallRequired,
            ServiceStatus::ReinstallRequired,
            ServiceStatus::ForceReinstallRequired,
            ServiceStatus::SidecarAllowed,
        ];
        for status in &rejected_statuses {
            assert!(!can_allow_sidecar_for_session(true, &RunningMode::NotRunning, status));
        }
    }

    #[test]
    fn failed_start_rolls_back_even_from_service_mode() {
        let manager = CoreManager::default();
        manager.set_running_mode(RunningMode::Service);
        manager.rollback_failed_start();
        assert_eq!(*manager.get_running_mode(), RunningMode::NotRunning);

        manager.set_running_mode(RunningMode::Sidecar);
        manager.rollback_failed_start();
        assert_eq!(*manager.get_running_mode(), RunningMode::NotRunning);
    }
}

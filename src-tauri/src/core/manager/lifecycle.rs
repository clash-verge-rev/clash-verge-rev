use super::{CoreManager, RunningMode};
use crate::cmd::StringifyErr as _;
use crate::config::{Config, IVerge};
use crate::constants::timing;
use crate::core::handle::Handle;
use crate::core::manager::CLASH_LOGGER;
use crate::core::service::{SERVICE_MANAGER, ServiceStatus};
use anyhow::Result;
use backoff::{Error as BackoffError, ExponentialBackoff};
use clash_verge_logging::{Type, logging};
use scopeguard::defer;
use smartstring::alias::String;
use tauri_plugin_clash_verge_sysinfo;

impl CoreManager {
    pub async fn start_core(&self) -> Result<()> {
        self.prepare_startup().await?;
        defer! {
            self.after_core_process();
        }

        match *self.get_running_mode() {
            RunningMode::Service => self.start_core_by_service().await,
            RunningMode::NotRunning | RunningMode::Sidecar => self.start_core_by_sidecar().await,
        }
    }

    pub async fn stop_core(&self) -> Result<()> {
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
        logging!(info, Type::Core, "Restarting core");
        self.stop_core().await?;
        self.start_core().await
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

        self.update_config().await.stringify_err()?;
        Ok(())
    }

    async fn prepare_startup(&self) -> Result<()> {
        self.wait_for_service_if_needed().await;

        let value = SERVICE_MANAGER.lock().await.current();
        let mode = match value {
            ServiceStatus::Ready => RunningMode::Service,
            _ => RunningMode::Sidecar,
        };

        self.set_running_mode(mode);
        Ok(())
    }

    fn after_core_process(&self) {
        let app_handle = Handle::app_handle();
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, self.get_running_mode().to_string());
    }

    async fn wait_for_service_if_needed(&self) {
        #[cfg(target_os = "windows")]
        {
            let needs_service = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);

            if !needs_service {
                return;
            }
        }

        // 在 unix 上，如果服务状态是 "Need Checks"，尝试初始化服务管理器
        // 在 Windows 上，只有在需要 TUN 模式时才等待服务
        let mut manager = SERVICE_MANAGER.lock().await;
        let current_status = manager.current();

        // 如果服务状态是 "Need Checks"，尝试初始化服务管理器
        if matches!(current_status, ServiceStatus::Unavailable(ref reason) if reason == "Need Checks") {
            // 尝试初始化服务管理器，即使 IPC 路径可能暂时不存在
            if let Err(e) = manager.init().await {
                logging!(debug, Type::Core, "服务管理器初始化失败（可能服务未启动）: {}", e);
            } else {
                // 初始化成功，尝试刷新状态
                let _ = manager.refresh().await;
            }
        }

        // 如果服务已经就绪，直接返回
        if matches!(manager.current(), ServiceStatus::Ready) {
            return;
        }

        drop(manager);

        // 使用退避重试策略等待服务就绪
        let backoff = ExponentialBackoff {
            initial_interval: timing::SERVICE_WAIT_INTERVAL,
            max_interval: timing::SERVICE_WAIT_INTERVAL,
            max_elapsed_time: Some(timing::SERVICE_WAIT_MAX),
            multiplier: 1.0,
            randomization_factor: 0.0,
            ..Default::default()
        };

        let operation = || async {
            let mut manager = SERVICE_MANAGER.lock().await;

            if matches!(manager.current(), ServiceStatus::Ready) {
                return Ok(());
            }

            // 如果服务管理器未初始化，尝试初始化
            if matches!(manager.current(), ServiceStatus::Unavailable(ref reason) if reason == "Need Checks") {
                manager.init().await.map_err(BackoffError::transient)?;
            }

            let _ = manager.refresh().await;

            if matches!(manager.current(), ServiceStatus::Ready) {
                Ok(())
            } else {
                Err(BackoffError::transient(anyhow::anyhow!("Service not ready")))
            }
        };

        let _ = backoff::future::retry(backoff, operation).await;
    }
}

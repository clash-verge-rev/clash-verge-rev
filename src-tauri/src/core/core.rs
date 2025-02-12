use crate::config::*;
use crate::core::{clash_api, handle, service};
use crate::core::tray::Tray;
use crate::log_err;
use crate::utils::dirs;
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use serde_yaml::Mapping;
use std::{sync::Arc, time::Duration};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use tokio::time::sleep;
use super::process_lock::ProcessLock;
use super::health_check::HealthChecker;

#[derive(Debug)]
pub struct CoreManager {
    running: Arc<Mutex<bool>>,
    process_lock: Arc<Mutex<Option<ProcessLock>>>,
    health_checker: HealthChecker,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();
        CORE_MANAGER.get_or_init(|| CoreManager {
            running: Arc::new(Mutex::new(false)),
            process_lock: Arc::new(Mutex::new(None)),
            health_checker: HealthChecker::new(),
        })
    }

    pub async fn init(&self) -> Result<()> {
        log::trace!("run core start");
        
        // 初始化进程锁
        let process_lock = ProcessLock::new()?;
        process_lock.acquire()?;
        *self.process_lock.lock().await = Some(process_lock);

        // 启动clash
        log_err!(Self::global().start_core().await);
        log::trace!("run core end");
        Ok(())
    }

    /// 检查订阅是否正确
    pub async fn check_config(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("verge-mihomo".into());

        let test_dir = dirs::app_home_dir()?.join("test");
        let test_dir = dirs::path_to_str(&test_dir)?;
        let app_handle = handle::Handle::global().app_handle().unwrap();

        let _ = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-t", "-d", test_dir, "-f", config_path])
            .output()
            .await?;

        Ok(())
    }

    /// 停止核心运行
    pub async fn stop_core(&self) -> Result<()> {
        log::info!(target: "app", "Stopping core");

        // 关闭tun模式
        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());
        log::debug!(target: "app", "Disabling TUN mode");
        let _ = clash_api::patch_configs(&disable).await;

        // 直接尝试停止服务，不预先检查状态
        log::info!(target: "app", "Attempting to stop service");
        let _ = service::stop_core_by_service().await;

        // 设置运行状态
        *self.running.lock().await = false;

        // 释放进程锁
        let mut process_lock = self.process_lock.lock().await;
        if let Some(lock) = process_lock.take() {
            log::info!(target: "app", "Releasing process lock");
            let _ = lock.release();
        }

        log::info!(target: "app", "Core stopped successfully");
        Ok(())
    }

    /// 启动核心
    pub async fn start_core(&self) -> Result<()> {
        #[cfg(not(target_os = "macos"))]
        // 检查端口占用
        self.health_checker.check_ports().await?;

        let config_path = Config::generate_file(ConfigType::Run)?;

        // 服务模式
        if service::check_service().await.is_ok() {
            log::info!(target: "app", "try to run core in service mode");
            service::run_core_by_service(&config_path).await?;
        }

        // 启动健康检查
        let checker = Arc::new(self.health_checker.clone());
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(30)).await;
                if let Err(e) = checker.check_service_health().await {
                    log::error!(target: "app", "Health check failed: {}", e);
                }
            }
        });

        // 流量订阅
        #[cfg(target_os = "macos")]
        log_err!(Tray::global().subscribe_traffic().await);

        *self.running.lock().await = true;
        Ok(())
    }

    /// 重启内核
    pub async fn restart_core(&self) -> Result<()> {
        // 重新启动app
        self.stop_core().await?;
        self.start_core().await?;
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
        const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

        if !CLASH_CORES.contains(&clash_core.as_str()) {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::info!(target: "app", "change core to `{clash_core}`");

        Config::verge().draft().clash_core = Some(clash_core);

        // 更新订阅
        Config::generate().await?;

        self.check_config().await?;

        match self.restart_core().await {
            Ok(_) => {
                Config::verge().apply();
                Config::runtime().apply();
                log_err!(Config::verge().latest().save_file());
                Ok(())
            }
            Err(err) => {
                Config::verge().discard();
                Config::runtime().discard();
                Err(err)
            }
        }
    }

    /// 更新proxies那些
    /// 如果涉及端口和外部控制则需要重启
    pub async fn update_config(&self) -> Result<()> {
        log::debug!(target: "app", "try to update clash config");
        // 更新订阅
        Config::generate().await?;

        // 检查订阅是否正常
        self.check_config().await?;

        // 更新运行时订阅
        let path = Config::generate_file(ConfigType::Run)?;
        let path = dirs::path_to_str(&path)?;

        // 发送请求 发送5次
        for i in 0..10 {
            match clash_api::put_configs(path).await {
                Ok(_) => break,
                Err(err) => {
                    if i < 9 {
                        log::info!(target: "app", "{err}");
                    } else {
                        bail!(err);
                    }
                }
            }
            sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }
}

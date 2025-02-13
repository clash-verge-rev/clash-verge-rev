#[cfg(not(target_os = "macos"))]
use anyhow::{bail, Result};
#[cfg(target_os = "macos")]
use anyhow::{Result, Error};
use sysinfo::{Pid, System, Signal};
use crate::config::Config;
use crate::core::service;
#[cfg(not(target_os = "macos"))]
use port_scanner::local_port_available;
use std::time::Duration;
use tokio::time::timeout;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use crate::config::ConfigType;

const PORT_CHECK_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_FAILURES: u32 = 3;

#[derive(Debug, Clone)]
pub struct HealthChecker {
    failure_count: Arc<AtomicU32>,
}

impl HealthChecker {
    pub fn new() -> Self {
        Self {
            failure_count: Arc::new(AtomicU32::new(0)),
        }
    }

    #[cfg(not(target_os = "macos"))]
    async fn check_single_port(port: u16) -> Result<()> {
        let port_check = timeout(PORT_CHECK_TIMEOUT, async move {
            if !local_port_available(port) {
                return Err(Error::msg(format!("Port {} is already in use", port)));
            }
            Ok(())
        }).await;

        match port_check {
            Ok(result) => result,
            Err(_) => Err(Error::msg(format!("Port check timeout for port {}", port))),
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn check_ports(&self) -> Result<()> {
        let verge = Config::verge();
        let verge_config = verge.latest();
        
        let ports = vec![
            (verge_config.verge_mixed_port.unwrap_or(7897), "Mixed"),
            (verge_config.verge_socks_port.unwrap_or(7890), "Socks"),
            (verge_config.verge_port.unwrap_or(7891), "Http"),
        ];

        for (port, port_type) in ports {
            if port_type != "Mixed" && !verge_config.verge_socks_enabled.unwrap_or(true) {
                continue;
            }

            match Self::check_single_port(port).await {
                Ok(_) => {
                    log::debug!(target: "app", "{} port {} is available", port_type, port);
                }
                Err(e) => {
                    log::error!(target: "app", "{} port {} check failed: {}", port_type, port, e);
                    return Err(Error::msg(format!("{} port {} is unavailable: {}", port_type, port, e)));
                }
            }
        }

        Ok(())
    }

    async fn check_process_health(&self) -> Result<()> {
        let sys = System::new_all();
        
        if let Ok(response) = service::check_service().await {
            if let Some(body) = response.data {
                if let Ok(pid) = body.bin_path.parse::<u32>() {
                    if let Some(process) = sys.process(Pid::from(pid as usize)) {
                        if process.name().to_string_lossy().contains("mihomo") {
                            // 检查进程CPU和内存使用
                            let cpu_usage = process.cpu_usage();
                            let memory_usage = process.memory() / 1024 / 1024; // Convert to MB

                            if cpu_usage > 90.0 {
                                return Err(Error::msg(format!("Process CPU usage too high: {}%", cpu_usage)));
                            }

                            if memory_usage > 1024 { // 1GB
                                return Err(Error::msg(format!("Process memory usage too high: {}MB", memory_usage)));
                            }

                            return Ok(());
                        }
                    }
                }
            }
        }
        
        Err(Error::msg("Process health check failed"))
    }

    pub async fn check_service_health(&self) -> Result<()> {
        match timeout(HEALTH_CHECK_TIMEOUT, self.check_process_health()).await {
            Ok(result) => {
                match result {
                    Ok(_) => {
                        // 重置失败计数
                        self.failure_count.store(0, Ordering::SeqCst);
                        Ok(())
                    }
                    Err(e) => {
                        // 增加失败计数
                        let current_failures = self.failure_count.fetch_add(1, Ordering::SeqCst);
                        log::warn!(target: "app", "Health check failed ({}/{}): {}", current_failures + 1, MAX_FAILURES, e);

                        if current_failures + 1 >= MAX_FAILURES {
                            log::error!(target: "app", "Maximum health check failures reached, attempting recovery");
                            self.attempt_recovery().await?;
                            self.failure_count.store(0, Ordering::SeqCst);
                        }
                        
                        Err(e)
                    }
                }
            }
            Err(_) => {
                let current_failures = self.failure_count.fetch_add(1, Ordering::SeqCst);
                log::warn!(target: "app", "Health check timeout ({}/{})", current_failures + 1, MAX_FAILURES);
                
                if current_failures + 1 >= MAX_FAILURES {
                    log::error!(target: "app", "Maximum health check timeouts reached, attempting recovery");
                    self.attempt_recovery().await?;
                    self.failure_count.store(0, Ordering::SeqCst);
                }
                
                Err(Error::msg("Health check timeout"))
            }
        }
    }

    async fn attempt_recovery(&self) -> Result<()> {
        log::info!(target: "app", "Attempting service recovery");
        
        // 尝试重启服务
        if let Ok(response) = service::check_service().await {
            if let Some(body) = response.data {
                if let Ok(pid) = body.bin_path.parse::<u32>() {
                    let sys = System::new_all();
                    if let Some(process) = sys.process(Pid::from(pid as usize)) {
                        #[cfg(not(target_os = "windows"))]
                        {
                            log::info!(target: "app", "Sending SIGTERM to process {}", pid);
                            let _ = process.kill_with(Signal::Term);
                        }
                        #[cfg(target_os = "windows")]
                        {
                            log::info!(target: "app", "Terminating process {}", pid);
                            process.kill();
                        }
                    }
                }
            }
        }

        // 等待进程完全终止
        tokio::time::sleep(Duration::from_secs(2)).await;

        // 重新启动服务
        match timeout(
            Duration::from_secs(30),
            service::run_core_by_service(&Config::generate_file(ConfigType::Run)?),
        ).await {
            Ok(result) => result,
            Err(_) => Err(Error::msg("Timeout while restarting service during recovery")),
        }?;

        log::info!(target: "app", "Service recovery completed");
        Ok(())
    }
} 
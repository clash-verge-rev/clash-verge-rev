use crate::config::*;
use crate::core::{clash_api, handle, service};
#[cfg(target_os = "macos")]
use crate::core::tray::Tray;
use crate::log_err;
use crate::utils::dirs;
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use serde_yaml::Mapping;
use std::{sync::Arc, time::Duration};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use tokio::time::{timeout, sleep};
use super::process_lock::ProcessLock;
use super::health_check::HealthChecker;
use tokio::sync::Mutex as TokioMutex;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};

const SERVICE_TIMEOUT: Duration = Duration::from_secs(5);
const CORE_STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const RESTART_COOLDOWN: Duration = Duration::from_millis(500);

// 全局状态锁，确保状态更新的互斥性
static CORE_STATE_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));

#[derive(Debug)]
pub struct CoreManager {
    running: Arc<Mutex<bool>>,
    process_lock: Arc<Mutex<Option<ProcessLock>>>,
    health_checker: HealthChecker,
    last_operation: Arc<Mutex<Option<std::time::Instant>>>,
    is_operating: Arc<AtomicBool>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();
        CORE_MANAGER.get_or_init(|| CoreManager {
            running: Arc::new(Mutex::new(false)),
            process_lock: Arc::new(Mutex::new(None)),
            health_checker: HealthChecker::new(),
            last_operation: Arc::new(Mutex::new(None)),
            is_operating: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn init(&self) -> Result<()> {
        log::info!(target: "app", "Initializing core manager");
        
        // 获取状态锁
        let _state_lock = CORE_STATE_LOCK.lock().await;
        
        // 检查是否已有运行中的服务进程
        if let Ok(response) = service::check_service().await {
            if response.data.is_some() {
                log::info!(target: "app", "Found existing service process, attempting to take control");
                
                // 尝试接管现有进程
                if let Some(process_lock) = ProcessLock::new()?.acquire_existing().await {
                    log::info!(target: "app", "Successfully took control of existing process");
                    *self.process_lock.lock().await = Some(process_lock);
                    *self.running.lock().await = true;
                    
                    // 启动健康检查监控
                    self.health_checker.start_monitoring();
                    println!("[核心管理] 接管现有进程并启动健康检查");
                    
                    return Ok(());
                } else {
                    log::warn!(target: "app", "Could not take control of existing process, will clean up");
                    if let Err(e) = service::force_kill_service_process().await {
                        log::error!(target: "app", "Failed to clean up service process: {}", e);
                    }
                }
                
                // 等待一段时间确保进程完全终止
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }

        // 如果没有找到服务进程或无法接管，则强制清理所有可能的 verge-mihomo 进程
        log::info!(target: "app", "Checking for zombie core processes");
        if let Some(process_lock) = ProcessLock::new()?.acquire_force().await {
            log::info!(target: "app", "Successfully cleaned up zombie processes");
            *self.process_lock.lock().await = Some(process_lock);
        } else {
            log::error!(target: "app", "Failed to acquire process lock during cleanup");
            bail!("Failed to clean up existing processes");
        }

        // 再次检查确保所有进程都已清理
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // 启动核心
        match timeout(CORE_STARTUP_TIMEOUT, self.start_core()).await {
            Ok(result) => {
                log_err!(result);
                println!("[核心管理] 核心初始化完成");
                
                // 启动健康检查监控（不需要await）
                self.health_checker.start_monitoring();
                println!("[核心管理] 健康检查监控已启动");
                
                Ok(())
            }
            Err(_) => {
                println!("[核心管理错误] 核心启动超时");
                bail!("核心启动超时");
            }
        }
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

        match timeout(Duration::from_secs(10), 
            app_handle.shell().sidecar(clash_core)?
                .args(["-t", "-d", test_dir, "-f", config_path])
                .output()
        ).await {
            Ok(result) => {
                result?;
                Ok(())
            }
            Err(_) => {
                bail!("Timeout while checking config");
            }
        }
    }

    /// 停止核心运行
    pub async fn stop_core(&self) -> Result<()> {
        // 先停止健康检查
        self.health_checker.stop_monitoring();
        println!("[核心管理] 健康检查已停止");

        // 获取状态锁
        let _state_lock = CORE_STATE_LOCK.lock().await;
        
        if !*self.running.lock().await {
            log::info!(target: "app", "Core is not running, skip stopping");
            return Ok(());
        }

        log::info!(target: "app", "Stopping core");

        // 关闭tun模式
        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());
        
        // 尝试禁用 TUN 模式，但不等待太久
        let _ = timeout(Duration::from_secs(1), clash_api::patch_configs(&disable)).await;

        // 停止服务
        match timeout(Duration::from_secs(3), service::stop_core_by_service()).await {
            Ok(result) => {
                if let Err(e) = result {
                    log::error!(target: "app", "Error stopping service: {}", e);
                }
            }
            Err(_) => {
                log::error!(target: "app", "Timeout while stopping service");
                // 超时的情况下，尝试强制终止服务进程
                if let Err(e) = service::force_kill_service_process().await {
                    log::error!(target: "app", "Failed to force kill service process: {}", e);
                }
            }
        }

        // 设置运行状态
        *self.running.lock().await = false;

        // 强制清理所有可能的残留进程
        let cleanup_result = async {
            // 释放当前进程锁
            if let Some(lock) = self.process_lock.lock().await.take() {
                let _ = timeout(PROCESS_CLEANUP_TIMEOUT, lock.release()).await;
            }

            // 强制获取新锁并清理
            if let Some(new_lock) = ProcessLock::new()?.acquire_force().await {
                let _ = new_lock.release().await;
            }

            // 等待确保资源释放
            sleep(Duration::from_millis(100)).await;
            Ok::<(), anyhow::Error>(())
        };

        // 设置清理超时
        match timeout(PROCESS_CLEANUP_TIMEOUT, cleanup_result).await {
            Ok(result) => {
                if let Err(e) = result {
                    log::error!(target: "app", "Error during cleanup: {}", e);
                }
            }
            Err(_) => {
                log::error!(target: "app", "Process cleanup timeout");
            }
        }

        Ok(())
    }

    /// 启动核心
    pub async fn start_core(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Run)?;

        // 服务模式
        if service::check_service().await.is_ok() {
            println!("[核心管理] 尝试以服务模式运行核心");
            match timeout(SERVICE_TIMEOUT, service::run_core_by_service(&config_path)).await {
                Ok(result) => result?,
                Err(_) => {
                    bail!("启动服务超时");
                }
            }
        }

        // 启动健康检查
        self.health_checker.start_monitoring();
        println!("[核心管理] 健康检查已启动");

        // 流量订阅
        #[cfg(target_os = "macos")]
        log_err!(Tray::global().subscribe_traffic().await);

        *self.running.lock().await = true;
        Ok(())
    }

    async fn check_cooldown(&self) -> bool {
        let mut last_op = self.last_operation.lock().await;
        let now = std::time::Instant::now();
        
        if let Some(last) = *last_op {
            if now.duration_since(last) < RESTART_COOLDOWN {
                return false;
            }
        }
        
        *last_op = Some(now);
        true
    }

    pub async fn restart_core(&self) -> Result<()> {
        // 检查是否已经在执行操作
        if self.is_operating.load(Ordering::SeqCst) {
            println!("[核心管理] 已有操作正在进行，跳过重启");
            return Ok(());
        }

        // 检查冷却时间
        if !self.check_cooldown().await {
            println!("[核心管理] 操作过于频繁，跳过重启");
            return Ok(());
        }

        // 设置操作状态
        self.is_operating.store(true, Ordering::SeqCst);

        let result = async {
            // 停止当前运行的核心
            if let Err(e) = self.stop_core().await {
                println!("[核心管理警告] 停止核心时出错: {}", e);
                // 继续执行，尝试强制重启
            }

            // 确保进程完全清理
            tokio::time::sleep(Duration::from_millis(100)).await;

            // 强制清理所有可能的残留进程
            if let Some(process_lock) = ProcessLock::new()?.acquire_force().await {
                *self.process_lock.lock().await = Some(process_lock);
            } else {
                println!("[核心管理错误] 无法获取进程锁");
                bail!("无法获取进程锁");
            }

            // 启动新核心
            match timeout(CORE_STARTUP_TIMEOUT, self.start_core()).await {
                Ok(result) => {
                    match result {
                        Ok(_) => {
                            println!("[核心管理] 核心重启完成");
                            Ok(())
                        }
                        Err(e) => {
                            println!("[核心管理错误] 启动核心失败: {}", e);
                            bail!("启动核心失败: {}", e)
                        }
                    }
                }
                Err(_) => {
                    println!("[核心管理错误] 核心启动超时");
                    bail!("核心启动超时")
                }
            }
        }.await;

        // 重置操作状态
        self.is_operating.store(false, Ordering::SeqCst);

        result
    }

    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        // 检查是否已经在执行操作
        if self.is_operating.load(Ordering::SeqCst) {
            log::info!(target: "app", "Core operation already in progress, skipping core change");
            return Ok(());
        }

        // 检查冷却时间
        if !self.check_cooldown().await {
            log::info!(target: "app", "Operation too frequent, skipping core change");
            return Ok(());
        }

        // 设置操作状态
        self.is_operating.store(true, Ordering::SeqCst);

        let result = async {
            let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
            const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

            if !CLASH_CORES.contains(&clash_core.as_str()) {
                bail!("invalid clash core name \"{clash_core}\"");
            }

            // 检查是否与当前运行的核心相同
            let current = {
                let verge = Config::verge();
                let verge_config = verge.latest();
                verge_config
                    .clash_core
                    .as_ref()
                    .map(|s| s.as_str())
                    .unwrap_or_default()
                    .to_string()
            };

            if current == clash_core {
                log::info!(target: "app", "Core is already {}, skipping change", clash_core);
                return Ok(());
            }

            // 先停止当前运行的核心
            if let Err(e) = self.stop_core().await {
                log::error!(target: "app", "Error stopping current core: {}", e);
                // 继续执行，尝试强制切换
            }

            // 确保进程完全清理
            sleep(Duration::from_millis(100)).await;

            // 更新配置
            {
                let verge = Config::verge();
                verge.draft().clash_core = Some(clash_core.clone());
                verge.apply().ok_or_else(|| anyhow::anyhow!("Failed to apply config"))?;
            }

            // 强制清理所有可能的残留进程
            if let Some(process_lock) = ProcessLock::new()?.acquire_force().await {
                *self.process_lock.lock().await = Some(process_lock);
            } else {
                log::error!(target: "app", "Failed to acquire process lock");
                bail!("Failed to acquire process lock");
            }

            // 启动新核心
            match timeout(CORE_STARTUP_TIMEOUT, self.start_core()).await {
                Ok(result) => {
                    match result {
                        Ok(_) => {
                            log::info!(target: "app", "Core change completed successfully to {}", clash_core);
                            Ok(())
                        }
                        Err(e) => {
                            log::error!(target: "app", "Failed to start new core: {}", e);
                            bail!("Failed to start new core: {}", e)
                        }
                    }
                }
                Err(_) => {
                    log::error!(target: "app", "Core startup timeout");
                    bail!("Core startup timeout")
                }
            }
        }.await;

        // 重置操作状态
        self.is_operating.store(false, Ordering::SeqCst);

        result
    }

    /// 更新proxies那些
    /// 如果涉及端口和外部控制则需要重启
    pub async fn update_config(&self) -> Result<()> {
        // 检查是否已经在执行操作
        if self.is_operating.load(Ordering::SeqCst) {
            log::info!(target: "app", "Core operation already in progress, skipping config update");
            return Ok(());
        }

        // 检查冷却时间
        if !self.check_cooldown().await {
            log::info!(target: "app", "Operation too frequent, skipping config update");
            return Ok(());
        }

        // 设置操作状态
        self.is_operating.store(true, Ordering::SeqCst);

        let result = async {
            let config_file = Config::generate_file(ConfigType::Run)?;
            match timeout(
                SERVICE_TIMEOUT,
                service::run_core_by_service(&config_file),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => bail!("timeout"),
            }
        }.await;

        // 重置操作状态
        self.is_operating.store(false, Ordering::SeqCst);

        result
    }

    /// 程序退出时的清理工作
    pub async fn cleanup_on_exit(&self) -> Result<()> {
        log::info!(target: "app", "Performing cleanup on exit");

        // 获取状态锁
        let _state_lock = CORE_STATE_LOCK.lock().await;

        // 先停止健康检查
        self.health_checker.stop_monitoring();
        println!("[核心管理] 健康检查已停止");

        // 设置退出标志
        *self.running.lock().await = false;
        self.is_operating.store(false, Ordering::SeqCst);

        // 尝试正常停止核心
        let stop_result = async {
            // 关闭tun模式
            let mut disable = Mapping::new();
            let mut tun = Mapping::new();
            tun.insert("enable".into(), false.into());
            disable.insert("tun".into(), tun.into());
            
            // 尝试禁用 TUN 模式，但不等待太久
            let _ = timeout(Duration::from_secs(1), clash_api::patch_configs(&disable)).await;

            // 停止服务
            if let Err(e) = service::stop_core_by_service().await {
                log::error!(target: "app", "Error stopping service: {}", e);
                // 如果停止失败，尝试强制终止
                if let Err(e) = service::force_kill_service_process().await {
                    log::error!(target: "app", "Failed to force kill service process: {}", e);
                }
            }

            // 等待确保进程完全终止
            tokio::time::sleep(Duration::from_millis(100)).await;

            // 释放当前进程锁
            if let Some(lock) = self.process_lock.lock().await.take() {
                if let Err(e) = lock.release().await {
                    log::error!(target: "app", "Error releasing process lock: {}", e);
                }
            }

            // 最后一次检查并清理所有可能的残留进程
            if let Some(process_lock) = ProcessLock::new()?.acquire_force().await {
                log::info!(target: "app", "Successfully cleaned up remaining processes");
                let _ = process_lock.release().await;
            }

            Ok::<(), anyhow::Error>(())
        };

        // 设置清理超时
        match timeout(Duration::from_secs(5), stop_result).await {
            Ok(result) => {
                if let Err(e) = result {
                    log::error!(target: "app", "Error during cleanup: {}", e);
                }
            }
            Err(_) => {
                log::error!(target: "app", "Cleanup timeout, forcing termination");
                // 超时后的最后尝试
                if let Err(e) = service::force_kill_service_process().await {
                    log::error!(target: "app", "Final force kill attempt failed: {}", e);
                }
            }
        }

        log::info!(target: "app", "Exit cleanup completed");
        Ok(())
    }
}


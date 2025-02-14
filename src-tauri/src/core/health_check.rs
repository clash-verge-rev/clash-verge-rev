use anyhow::{bail, Result, Error};
use sysinfo::System;
use crate::config::Config;
use crate::core::service;
use std::time::Duration;
use tokio::time::timeout;
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
use std::sync::Arc;
use crate::config::ConfigType;
use tokio::sync::Mutex;

const SERVICE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_FAILURES: u32 = 3;
const SERVICE_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const CPU_USAGE_THRESHOLD: f32 = 90.0;
const MEMORY_USAGE_THRESHOLD: u64 = 1024; // 1GB in MB

#[derive(Debug, Clone)]
pub struct HealthChecker {
    failure_count: Arc<AtomicU32>,
    process_lock: Arc<Mutex<()>>,
    is_monitoring: Arc<AtomicBool>,
}

impl HealthChecker {
    pub fn new() -> Self {
        Self {
            failure_count: Arc::new(AtomicU32::new(0)),
            process_lock: Arc::new(Mutex::new(())),
            is_monitoring: Arc::new(AtomicBool::new(false)),
        }
    }

    async fn check_service_responsive(&self) -> Result<()> {
        match timeout(SERVICE_CHECK_TIMEOUT, service::check_service()).await {
            Ok(result) => {
                result?;  // 检查服务调用是否成功
                Ok(())   // 明确返回 Ok(())
            },
            Err(_) => return Err(Error::msg("服务响应超时")),
        }
    }

    async fn check_process_health(&self) -> Result<()> {
        let mut sys = System::new_all();
        sys.refresh_all();
        
        // 1. 服务状态检查
        if let Ok(response) = service::check_service().await {
            if response.data.is_some() {
                // 2. 进程存在性检查
                for (_pid, process) in sys.processes() {
                    if process.name().to_string_lossy().contains("mihomo") {
                        // 3. 进程状态检查
                        let status = process.status();
                        if status.to_string().contains("Zombie") {
                            return Err(Error::msg("进程处于僵尸状态"));
                        }

                        // 4. 资源使用检查
                        let cpu_usage = process.cpu_usage();
                        let memory_usage = process.memory() / 1024 / 1024;

                        if cpu_usage > CPU_USAGE_THRESHOLD {
                            return Err(Error::msg(format!("CPU使用率过高: {:.1}%", cpu_usage)));
                        }

                        if memory_usage > MEMORY_USAGE_THRESHOLD {
                            return Err(Error::msg(format!("内存使用过高: {}MB", memory_usage)));
                        }

                        // 5. 服务响应性检查
                        if let Err(e) = self.check_service_responsive().await {
                            return Err(Error::msg(format!("服务无响应: {}", e)));
                        }

                        return Ok(());
                    }
                }
                return Err(Error::msg("未找到运行中的 mihomo 进程"));
            }
            return Err(Error::msg("服务状态数据为空"));
        }
        Err(Error::msg("服务检查失败"))
    }

    pub async fn check_service_health(&self) -> Result<()> {
        // 检查进程健康状态
        if let Err(e) = self.check_process_health().await {
            eprintln!("[健康检查错误] 检查失败: {}", e);
            
            // 根据错误类型决定处理策略
            if e.to_string().contains("未找到运行中的 mihomo 进程") {
                // 进程不存在时立即尝试恢复
                println!("[健康检查警告] 检测到进程不存在，立即尝试恢复");
                match self.attempt_recovery().await {
                    Ok(_) => {
                        println!("[健康检查] 服务恢复成功，重置失败计数");
                        self.failure_count.store(0, Ordering::SeqCst);
                        return Ok(());
                    }
                    Err(e) => {
                        eprintln!("[健康检查错误] 服务恢复失败: {}", e);
                        return Err(e);
                    }
                }
            } else {
                // 其他类型的错误使用累计失败计数
                self.failure_count.fetch_add(1, Ordering::SeqCst);
                let current_failures = self.failure_count.load(Ordering::SeqCst);
                
                if current_failures >= MAX_FAILURES {
                    println!("[健康检查警告] 达到最大失败次数({}次)，开始尝试恢复", current_failures);
                    match self.attempt_recovery().await {
                        Ok(_) => {
                            println!("[健康检查] 服务恢复成功，重置失败计数");
                            self.failure_count.store(0, Ordering::SeqCst);
                            return Ok(());
                        }
                        Err(e) => {
                            eprintln!("[健康检查错误] 服务恢复失败: {}", e);
                            return Err(e);
                        }
                    }
                } else {
                    println!("[健康检查警告] 服务异常 ({}/{}): {}", current_failures, MAX_FAILURES, e);
                }
            }
            
            bail!("服务健康检查失败: {}", e);
        }

        // 重置失败计数
        self.failure_count.store(0, Ordering::SeqCst);
        Ok(())
    }

    async fn recover_service_mode(&self) -> Result<()> {
        println!("[健康检查] 以服务模式恢复");
        
        // 1. 停止服务
        if let Err(e) = service::stop_core_by_service().await {
            println!("[健康检查警告] 停止服务失败: {}", e);
            // 强制终止
            if let Err(e) = service::force_kill_service_process().await {
                eprintln!("[健康检查错误] 强制终止服务失败: {}", e);
            }
        }
        
        // 2. 等待进程完全终止
        tokio::time::sleep(Duration::from_secs(1)).await;
        
        // 3. 重新生成配置
        let config_path = match Config::generate_file(ConfigType::Run) {
            Ok(path) => path,
            Err(e) => {
                eprintln!("[健康检查错误] 生成配置文件失败: {}", e);
                return Err(e);
            }
        };
        
        // 4. 重启服务
        match timeout(SERVICE_TIMEOUT, service::run_core_by_service(&config_path)).await {
            Ok(Ok(_)) => {
                println!("[健康检查] 服务恢复成功");
                Ok(())
            }
            Ok(Err(e)) => {
                eprintln!("[健康检查错误] 重启服务失败: {}", e);
                Err(e)
            }
            Err(_) => {
                eprintln!("[健康检查错误] 服务重启超时");
                Err(Error::msg("服务重启超时"))
            }
        }
    }

    async fn recover_normal_mode(&self) -> Result<()> {
        println!("[健康检查] 以普通模式恢复");
        let core_manager = crate::core::CoreManager::global();
        match core_manager.restart_core().await {
            Ok(_) => {
                println!("[健康检查] 核心服务恢复成功");
                Ok(())
            }
            Err(e) => {
                eprintln!("[健康检查错误] 恢复核心服务失败: {}", e);
                Err(e)
            }
        }
    }

    async fn attempt_recovery(&self) -> Result<()> {
        println!("[健康检查] 尝试恢复核心服务");
        
        let is_service_mode = service::check_service().await.is_ok();
        
        if is_service_mode {
            self.recover_service_mode().await
        } else {
            self.recover_normal_mode().await
        }
    }

    pub fn start_monitoring(&self) {
        // 如果已经在监控中，就不要重复启动
        if self.is_monitoring.load(Ordering::SeqCst) {
            println!("[健康检查] 监控服务已在运行中");
            return;
        }

        self.is_monitoring.store(true, Ordering::SeqCst);
        let checker = Arc::new(self.clone());
        
        tokio::spawn(async move {
            println!("[健康检查] 监控服务已启动");
            
            // 错误恢复重试机制
            let mut consecutive_errors = 0;
            const MAX_CONSECUTIVE_ERRORS: u32 = 3;
            const ERROR_RESET_INTERVAL: Duration = Duration::from_secs(300); // 5分钟无错误则重置计数
            let mut last_error_time = None;
            
            while checker.is_monitoring.load(Ordering::SeqCst) {
                // 检查是否需要重置错误计数
                if let Some(last_time) = last_error_time {
                    if tokio::time::Instant::now() - last_time > ERROR_RESET_INTERVAL {
                        consecutive_errors = 0;
                        last_error_time = None;
                    }
                }

                // 如果连续错误太多，增加检查间隔
                let check_interval = if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    println!("[健康检查警告] 检测到频繁错误，增加检查间隔");
                    Duration::from_secs(60) // 增加到60秒
                } else {
                    Duration::from_secs(30) // 正常30秒
                };
                
                tokio::time::sleep(check_interval).await;
                
                // 获取锁来进行健康检查
                if let Ok(lock) = checker.process_lock.try_lock() {
                    match checker.check_service_health().await {
                        Ok(_) => {
                            println!("[健康检查] 检查通过");
                            consecutive_errors = 0;
                            last_error_time = None;
                            // 立即释放锁
                            drop(lock);
                        }
                        Err(e) => {
                            println!("[健康检查警告] {}", e);
                            consecutive_errors += 1;
                            last_error_time = Some(tokio::time::Instant::now());
                            // 错误情况下也要确保释放锁
                            drop(lock);
                        }
                    }
                } else {
                    // 如果无法获取锁，说明可能有其他操作正在进行
                    println!("[健康检查] 跳过本次检查：其他操作正在进行");
                }

                // 防止CPU占用过高
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            println!("[健康检查] 监控服务已停止");
        });
    }

    pub fn stop_monitoring(&self) {
        if self.is_monitoring.load(Ordering::SeqCst) {
            println!("[健康检查] 正在停止监控服务");
            self.is_monitoring.store(false, Ordering::SeqCst);
        }
    }
} 
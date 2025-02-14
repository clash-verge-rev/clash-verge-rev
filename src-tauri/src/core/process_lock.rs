use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use sysinfo::{Pid, System, Process};
#[cfg(not(target_os = "windows"))]
use sysinfo::Signal;
use crate::utils::dirs;
use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use once_cell::sync::Lazy;

const KILL_WAIT: Duration = Duration::from_millis(50);
const PROCESS_CHECK_ATTEMPTS: u32 = 3;
const MAX_CLEANUP_ATTEMPTS: u32 = 2;

// 全局进程锁，确保进程操作的互斥性
static PROCESS_OPERATION_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));

#[derive(Debug)]
pub struct ProcessLock {
    pid_file: PathBuf,
    acquired: Arc<AtomicBool>,
}

impl ProcessLock {
    pub fn new() -> Result<Self> {
        let pid_file = dirs::app_home_dir()?.join("mihomo.pid");
        Ok(Self { 
            pid_file,
            acquired: Arc::new(AtomicBool::new(false)),
        })
    }

    fn is_target_process(process_name: &str) -> bool {
        let name = process_name.to_lowercase();
        name == "verge-mihomo" || 
        name == "verge-mihomo-alpha" || 
        name == "verge-mihomo.exe" || 
        name == "verge-mihomo-alpha.exe"
    }

    async fn find_running_cores() -> Vec<(Pid, String)> {
        let sys = System::new_all();
        
        sys.processes()
            .iter()
            .filter(|(_, process)| {
                let name = process.name().to_string_lossy().to_lowercase();
                Self::is_target_process(&name)
            })
            .map(|(pid, process)| (*pid, process.name().to_string_lossy().to_string()))
            .collect()
    }

    async fn ensure_process_terminated(pid: Pid) -> bool {
        for _ in 0..PROCESS_CHECK_ATTEMPTS {
            let sys = System::new_all();
            
            if sys.process(pid).is_none() {
                return true;
            }
            
            tokio::time::sleep(KILL_WAIT).await;
        }
        false
    }

    async fn kill_process(pid: Pid, process: &Process) -> bool {
        let process_name = process.name().to_string_lossy().to_lowercase();
        let process_pid = pid.as_u32();
        
        // 先尝试强制终止
        #[cfg(not(target_os = "windows"))]
        {
            let _ = process.kill_with(Signal::Kill);
        }
        #[cfg(target_os = "windows")]
        {
            process.kill();
        }

        // 等待进程退出
        if Self::ensure_process_terminated(pid).await {
            log::info!(target: "app", "Process terminated: {}({})", process_name, process_pid);
            return true;
        }

        false
    }

    /// 强制获取进程锁，不管当前状态如何
    pub async fn acquire_force(&self) -> Option<Self> {
        let _lock = PROCESS_OPERATION_LOCK.lock().await;
        
        // 强制清理所有运行中的核心进程
        for _ in 0..MAX_CLEANUP_ATTEMPTS {
            let running_cores = Self::find_running_cores().await;
            if running_cores.is_empty() {
                break;
            }

            for (pid, _) in running_cores {
                let sys = System::new_all();
                if let Some(process) = sys.process(pid) {
                    let _ = Self::kill_process(pid, process).await;
                }
            }

            tokio::time::sleep(KILL_WAIT).await;
        }

        // 删除可能存在的 PID 文件
        if self.pid_file.exists() {
            let _ = fs::remove_file(&self.pid_file);
        }

        // 写入新的 PID 文件
        if let Err(e) = fs::write(&self.pid_file, std::process::id().to_string()) {
            log::error!(target: "app", "Failed to write PID file: {}", e);
            return None;
        }

        Some(Self {
            pid_file: self.pid_file.clone(),
            acquired: Arc::new(AtomicBool::new(true)),
        })
    }

    /// 尝试接管现有进程，不强制终止
    pub async fn acquire_existing(&self) -> Option<Self> {
        let _lock = PROCESS_OPERATION_LOCK.lock().await;
        
        // 检查是否有运行中的核心进程
        let running_cores = Self::find_running_cores().await;
        if running_cores.is_empty() {
            return None;
        }

        // 检查 PID 文件
        if self.pid_file.exists() {
            if let Ok(content) = fs::read_to_string(&self.pid_file) {
                if let Ok(pid) = content.trim().parse::<u32>() {
                    // 检查 PID 文件中的进程是否存在且是目标进程
                    let sys = System::new_all();
                    if let Some(process) = sys.process(Pid::from_u32(pid)) {
                        let process_name = process.name().to_string_lossy();
                        if Self::is_target_process(&process_name) {
                            // PID 文件有效，直接接管
                            return Some(Self {
                                pid_file: self.pid_file.clone(),
                                acquired: Arc::new(AtomicBool::new(true)),
                            });
                        }
                    }
                }
            }
            // PID 文件无效，删除它
            let _ = fs::remove_file(&self.pid_file);
        }

        // 写入新的 PID 文件，使用找到的第一个运行中的进程
        let (pid, _) = running_cores[0];
        if let Err(e) = fs::write(&self.pid_file, pid.as_u32().to_string()) {
            log::error!(target: "app", "Failed to write PID file: {}", e);
            return None;
        }

        Some(Self {
            pid_file: self.pid_file.clone(),
            acquired: Arc::new(AtomicBool::new(true)),
        })
    }

    pub async fn release(&self) -> Result<()> {
        let _lock = PROCESS_OPERATION_LOCK.lock().await;

        if !self.acquired.load(Ordering::SeqCst) {
            return Ok(());
        }

        // 清理所有运行中的核心进程
        let running_cores = Self::find_running_cores().await;
        let mut failed_kills = Vec::new();

        for (pid, name) in running_cores {
            let sys = System::new_all();
            if let Some(process) = sys.process(pid) {
                if !Self::kill_process(pid, process).await {
                    failed_kills.push(format!("{}({})", name, pid.as_u32()));
                }
            }
        }

        if !failed_kills.is_empty() {
            log::error!(target: "app", "Failed to terminate processes: {}", failed_kills.join(", "));
        }
        
        if self.pid_file.exists() {
            let _ = fs::remove_file(&self.pid_file);
        }
        
        self.acquired.store(false, Ordering::SeqCst);
        Ok(())
    }
}

impl Drop for ProcessLock {
    fn drop(&mut self) {
        if self.acquired.load(Ordering::SeqCst) {
            let runtime = tokio::runtime::Runtime::new().unwrap();
            let _ = runtime.block_on(async {
                let _lock = PROCESS_OPERATION_LOCK.lock().await;
                self.release().await
            });
        }
    }
}
use anyhow::{bail, Result};
use std::fs;
use std::path::PathBuf;
use sysinfo::{Pid, System};
use crate::utils::dirs;
use std::time::Duration;

const KILL_WAIT: Duration = Duration::from_millis(500);
const FINAL_WAIT: Duration = Duration::from_millis(1000);

#[derive(Debug)]
pub struct ProcessLock {
    pid_file: PathBuf,
}

impl ProcessLock {
    pub fn new() -> Result<Self> {
        let pid_file = dirs::app_home_dir()?.join("mihomo.pid");
        println!("Creating ProcessLock with PID file: {:?}", pid_file);
        log::info!(target: "app", "Creating ProcessLock with PID file: {:?}", pid_file);
        Ok(Self { pid_file })
    }

    fn is_target_process(process_name: &str) -> bool {
        let name = process_name.to_lowercase();
        (name.contains("mihomo") || name.contains("clash")) 
            && !name.contains("clash-verge") 
            && !name.contains("clash.meta")
    }

    fn kill_process(pid: Pid, process: &sysinfo::Process) -> bool {
        let process_name = process.name().to_string_lossy().to_lowercase();
        let process_pid = pid.as_u32();
        
        println!("Force killing process (PID: {}, Name: {})", process_pid, process_name);
        log::info!(target: "app", "Force killing process (PID: {}, Name: {})", process_pid, process_name);
        
        // 直接使用 SIGKILL 强制终止
        #[cfg(not(target_os = "windows"))]
        {
            println!("Sending SIGKILL to process {}", process_pid);
            log::info!(target: "app", "Sending SIGKILL to process {}", process_pid);
            let _ = process.kill_with(Signal::Kill);
        }
        #[cfg(target_os = "windows")]
        {
            println!("Force killing process {}", process_pid);
            log::info!(target: "app", "Force killing process {}", process_pid);
            process.kill();
        }
        
        std::thread::sleep(KILL_WAIT);
        
        // 检查进程是否还在运行
        let mut sys = System::new();
        sys.refresh_all();
        
        let is_terminated = sys.process(pid).is_none();
        if !is_terminated {
            println!("Failed to terminate process {}", process_pid);
            log::error!(target: "app", "Failed to terminate process {}", process_pid);
        } else {
            println!("Process {} has been terminated", process_pid);
            log::info!(target: "app", "Process {} has been terminated", process_pid);
        }
        
        is_terminated
    }

    fn kill_other_processes(include_current: bool) -> Result<()> {
        println!("Starting process cleanup (include_current: {})", include_current);
        log::info!(target: "app", "Starting process cleanup (include_current: {})", include_current);
        
        let mut sys = System::new();
        sys.refresh_all();
        
        let current_pid = std::process::id();
        let mut failed_kills = Vec::new();
        
        // 收集需要终止的进程
        let target_processes: Vec<_> = sys.processes()
            .iter()
            .filter(|(pid, process)| {
                let process_pid = pid.as_u32();
                let process_name = process.name().to_string_lossy();
                
                Self::is_target_process(&process_name) && 
                (include_current || process_pid != current_pid)
            })
            .collect();
        
        // 如果没有目标进程，直接返回
        if target_processes.is_empty() {
            println!("No target processes found");
            log::info!(target: "app", "No target processes found");
            return Ok(());
        }
        
        // 终止进程
        for (pid, process) in target_processes {
            if !Self::kill_process(*pid, process) {
                failed_kills.push((pid.as_u32(), process.name().to_string_lossy().to_string()));
            }
        }
        
        // 最终检查
        std::thread::sleep(FINAL_WAIT);
        sys.refresh_all();
        
        let remaining: Vec<_> = sys.processes()
            .iter()
            .filter(|(_, process)| Self::is_target_process(&process.name().to_string_lossy()))
            .map(|(pid, process)| (pid.as_u32(), process.name().to_string_lossy().to_string()))
            .collect();
        
        if !remaining.is_empty() {
            println!("Failed to terminate processes: {:?}", remaining);
            log::error!(target: "app", "Failed to terminate processes: {:?}", remaining);
            bail!("Failed to terminate processes: {:?}", remaining);
        }
        
        println!("Process cleanup completed");
        log::info!(target: "app", "Process cleanup completed");
        Ok(())
    }

    pub fn acquire(&self) -> Result<()> {
        println!("Attempting to acquire process lock");
        log::info!(target: "app", "Attempting to acquire process lock");
        
        // 首先尝试终止其他进程
        Self::kill_other_processes(false)?;

        if self.pid_file.exists() {
            fs::remove_file(&self.pid_file)?;
        }

        fs::write(&self.pid_file, std::process::id().to_string())?;
        println!("Process lock acquired successfully");
        log::info!(target: "app", "Process lock acquired successfully");
        Ok(())
    }

    pub fn release(&self) -> Result<()> {
        println!("Starting release process");
        log::info!(target: "app", "Starting release process");
        
        Self::kill_other_processes(true)?;
        
        if self.pid_file.exists() {
            println!("Removing PID file");
            log::info!(target: "app", "Removing PID file");
            fs::remove_file(&self.pid_file)?;
        }
        
        println!("Release process completed");
        log::info!(target: "app", "Release process completed");
        Ok(())
    }
}

impl Drop for ProcessLock {
    fn drop(&mut self) {
        if self.pid_file.exists() {
            println!("ProcessLock being dropped");
            log::info!(target: "app", "ProcessLock being dropped");
            let _ = self.release();
        }
    }
}
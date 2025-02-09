use anyhow::{bail, Result};
use std::fs;
use std::path::PathBuf;
use sysinfo::{Pid, System, Signal};
use crate::utils::dirs;
use std::time::Duration;

const TERM_WAIT: Duration = Duration::from_millis(500);
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
        (process_name.contains("mihomo") || process_name.contains("clash")) 
            && !process_name.contains("clash-verge") 
            && !process_name.contains("clash.meta")
    }

    fn kill_process(pid: Pid, process: &sysinfo::Process) -> bool {
        let process_name = process.name().to_string_lossy().to_lowercase();
        let process_pid = pid.as_u32();
        
        println!("Terminating clash core process (PID: {}, Name: {})", process_pid, process_name);
        log::info!(target: "app", "Terminating clash core process (PID: {}, Name: {})", process_pid, process_name);
        
        // 首先尝试正常终止
        #[cfg(not(target_os = "windows"))]
        {
            println!("Sending SIGTERM to process {}", process_pid);
            log::info!(target: "app", "Sending SIGTERM to process {}", process_pid);
            let _ = process.kill_with(Signal::Term);
        }
        #[cfg(target_os = "windows")]
        {
            println!("Killing process {}", process_pid);
            log::info!(target: "app", "Killing process {}", process_pid);
            process.kill();
        }
        
        std::thread::sleep(TERM_WAIT);
        
        // 检查进程是否还在运行
        let mut new_sys = System::new();
        new_sys.refresh_all();
        if let Some(p) = new_sys.process(pid) {
            println!("Process {} still running, trying force kill", process_pid);
            log::info!(target: "app", "Process {} still running, trying force kill", process_pid);
            
            #[cfg(not(target_os = "windows"))]
            {
                println!("Sending SIGKILL to process {}", process_pid);
                log::info!(target: "app", "Sending SIGKILL to process {}", process_pid);
                let _ = p.kill_with(Signal::Kill);
            }
            #[cfg(target_os = "windows")]
            {
                println!("Force killing process {}", process_pid);
                log::info!(target: "app", "Force killing process {}", process_pid);
                p.kill();
            }
            
            std::thread::sleep(KILL_WAIT);
            
            // 再次检查进程是否存在
            new_sys.refresh_all();
            if new_sys.process(pid).is_some() {
                println!("Failed to terminate process {}", process_pid);
                log::error!(target: "app", "Failed to terminate process {}", process_pid);
                return false;
            }
        }
        
        println!("Process {} has been terminated", process_pid);
        log::info!(target: "app", "Process {} has been terminated", process_pid);
        true
    }

    fn kill_other_processes(include_current: bool) -> Result<()> {
        println!("Starting process cleanup (include_current: {})", include_current);
        log::info!(target: "app", "Starting process cleanup (include_current: {})", include_current);
        
        let mut sys = System::new();
        sys.refresh_all();
        
        let current_pid = std::process::id();
        println!("Current process ID: {}", current_pid);
        log::info!(target: "app", "Current process ID: {}", current_pid);
        
        let mut killed = false;
        let mut failed_kills = Vec::new();
        
        for (pid, process) in sys.processes() {
            let process_name = process.name().to_string_lossy().to_lowercase();
            
            if Self::is_target_process(&process_name) {
                let process_pid = pid.as_u32();
                if include_current || process_pid != current_pid {
                    if !Self::kill_process(*pid, process) {
                        failed_kills.push((process_pid, process_name.clone()));
                    }
                    killed = true;
                }
            }
        }
        
        if killed {
            std::thread::sleep(FINAL_WAIT);
            
            // 最终检查
            let mut final_sys = System::new();
            final_sys.refresh_all();
            
            let remaining: Vec<_> = final_sys.processes()
                .iter()
                .filter(|(_, process)| {
                    let name = process.name().to_string_lossy().to_lowercase();
                    Self::is_target_process(&name)
                })
                .map(|(pid, process)| {
                    (pid.as_u32(), process.name().to_string_lossy().to_string())
                })
                .collect();
            
            if !remaining.is_empty() {
                log::error!(target: "app", "Failed to terminate some processes: {:?}", remaining);
                bail!("Failed to terminate processes: {:?}", remaining);
            }
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
        // 只在 PID 文件还存在时执行释放
        if self.pid_file.exists() {
            println!("ProcessLock being dropped");
            log::info!(target: "app", "ProcessLock being dropped");
            let _ = self.release();
        }
    }
}
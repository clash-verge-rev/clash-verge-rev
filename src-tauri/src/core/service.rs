use crate::config::Config;
use crate::utils::dirs;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::{env::current_exe, process::Command as StdCommand};
use tokio::time::Duration;
use sysinfo::{ProcessesToUpdate, RefreshKind, System};

// Windows only

const SERVICE_URL: &str = "http://127.0.0.1:33211";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseBody {
    pub core_type: Option<String>,
    pub bin_path: String,
    pub config_dir: String,
    pub log_file: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
}

#[cfg(target_os = "windows")]
pub async fn reinstall_service() -> Result<()> {
    log::info!(target:"app", "reinstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service.exe");
    let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let _ = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).show(false).status()?,
        _ => StdCommand::new(uninstall_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path).show(false).status()?,
        _ => StdCommand::new(install_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn reinstall_service() -> Result<()> {
    log::info!(target:"app", "reinstall service");
    use users::get_effective_uid;

    let install_path = tauri::utils::platform::current_exe()?.with_file_name("install-service");

    let uninstall_path = tauri::utils::platform::current_exe()?.with_file_name("uninstall-service");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().replace(" ", "\\ ");
    let uninstall_shell: String = uninstall_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(uninstall_shell).status()?,
        _ => StdCommand::new(elevator.clone())
            .arg("sh")
            .arg("-c")
            .arg(uninstall_shell)
            .status()?,
    };
    log::info!(target:"app", "status code:{}", status.code().unwrap());

    let status = match get_effective_uid() {
        0 => StdCommand::new(install_shell).status()?,
        _ => StdCommand::new(elevator.clone())
            .arg("sh")
            .arg("-c")
            .arg(install_shell)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn reinstall_service() -> Result<()> {
    log::info!(target:"app", "reinstall service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service");
    let uninstall_path = binary_path.with_file_name("uninstall-service");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().into_owned();
    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();
    let command = format!(
        r#"do shell script "sudo '{uninstall_shell}' && sudo '{install_shell}'" with administrator privileges"#
    );

    log::debug!(target: "app", "command: {}", command);

    let status = StdCommand::new("osascript")
        .args(vec!["-e", &command])
        .status()?;

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap()
        );
    }
    Ok(())
}

/// check the windows service status
pub async fn check_service() -> Result<JsonResponse> {
    log::info!(target: "app", "Checking service status");
    println!("Checking service status");

    let url = format!("{SERVICE_URL}/get_clash");
    log::debug!(target: "app", "Sending request to {}", url);
    println!("Sending request to {}", url);

    let client = reqwest::ClientBuilder::new()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?;
    
    // 重试3次
    for i in 0..3 {
        match client.get(&url).send().await {
            Ok(resp) => {
                match resp.json::<JsonResponse>().await {
                    Ok(json) => {
                        log::info!(target: "app", "Service check response: {:?}", json);
                        println!("Service check response: {:?}", json);
                        return Ok(json);
                    }
                    Err(e) => {
                        log::error!(target: "app", "Failed to parse service response (attempt {}): {}", i + 1, e);
                        println!("Failed to parse service response (attempt {}): {}", i + 1, e);
                        if i == 2 {
                            return Err(e.into());
                        }
                    }
                }
            }
            Err(e) => {
                log::error!(target: "app", "Failed to connect to service (attempt {}): {}", i + 1, e);
                println!("Failed to connect to service (attempt {}): {}", i + 1, e);
                if i == 2 {
                    return Err(e.into());
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    bail!("Failed to check service after 3 attempts")
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    let clash_core = { Config::verge().latest().clash_core.clone() };
    let clash_core = clash_core.unwrap_or("verge-mihomo".into());

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let clash_bin = format!("{clash_core}{bin_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;

    let log_path = dirs::service_log_file()?;
    let log_path = dirs::path_to_str(&log_path)?;

    let config_file = dirs::path_to_str(config_file)?;

    let mut map = HashMap::new();
    map.insert("core_type", clash_core.as_str());
    map.insert("bin_path", bin_path);
    map.insert("config_dir", config_dir);
    map.insert("config_file", config_file);
    map.insert("log_file", log_path);

    log::info!(target:"app", "start service: {:?}", map.clone());

    let url = format!("{SERVICE_URL}/start_clash");
    let _ = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .json(&map)
        .send()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    Ok(())
}

/// 强制终止服务管理的进程
#[cfg(not(target_os = "macos"))]
pub async fn force_kill_service_process() -> Result<()> {
    // 1. 先通过服务 API 获取当前管理的进程
    if let Ok(response) = check_service().await {
        if let Some(body) = response.data {
            if let Ok(pid) = body.bin_path.parse::<u32>() {
                log::info!(target: "app", "Found service process with PID: {}", pid);

                #[cfg(target_os = "linux")]
                {
                    let _ = std::process::Command::new("kill")
                        .arg("-15")
                        .arg(pid.to_string())
                        .output();
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = std::process::Command::new("kill")
                        .arg("-9")
                        .arg(pid.to_string())
                        .output();
                }

                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .output();
                }

                log::info!(target: "app", "Sent kill signal to process {}", pid);
            }
        }
    }

    // 2. 扫描并清理所有可能的 verge-mihomo 进程
    let mut system = System::new_with_specifics(RefreshKind::everything());
    system.refresh_processes(ProcessesToUpdate::All, true);

    for (pid, process) in system.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("verge-mihomo") {
            log::warn!(target: "app", "Found orphaned process: {} ({})", name, pid);

            let pid_value = pid.as_u32();

            #[cfg(target_os = "linux")]
            {
                let _ = std::process::Command::new("kill")
                    .arg("-15")
                    .arg(pid_value.to_string())
                    .output();
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = std::process::Command::new("kill")
                    .arg("-9")
                    .arg(pid_value.to_string())
                    .output();
            }

            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid_value.to_string()])
                    .output();
            }

            log::info!(target: "app", "Sent kill signal to orphaned process {}", pid_value);
        }
    }

    // 3. 等待确保进程完全终止
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 4. 再次检查确保清理完成
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut found_processes = Vec::new();

    for (pid, process) in system.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name.contains("verge-mihomo") {
            found_processes.push(format!("{} ({})", name, pid));
        }
    }

    if !found_processes.is_empty() {
        log::error!(target: "app", "Failed to clean up all processes: {}", found_processes.join(", "));
        bail!(
            "Failed to clean up processes: {}",
            found_processes.join(", ")
        );
    }

    Ok(())
}

/// 强制终止服务管理的进程
#[cfg(target_os = "macos")]
pub async fn force_kill_service_process() -> Result<()> {
    let _ = stop_service_by_service();

    let mut system = System::new_with_specifics(RefreshKind::everything());
    std::thread::sleep(std::time::Duration::from_millis(200));
    system.refresh_processes(ProcessesToUpdate::All, true);

    let remain_mihomo_processes = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            let name = process.name().to_string_lossy().to_lowercase();
            if name.contains("verge-mihomo") {
                Some(format!("{} ({})", name, pid))
            } else {
                None
            }
        })
        .collect::<Vec<String>>();

    log::info!(target: "app", "remain services after force kill: {:?}", remain_mihomo_processes);

    if !remain_mihomo_processes.is_empty() {
        log::error!(target: "app", "Failed to clean up all processes: {}", remain_mihomo_processes.join(", "));
        bail!(
            "Failed to clean up processes: {}",
            remain_mihomo_processes.join(", ")
        );
    }

    Ok(())
}

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> Result<()> {
    log::info!(target: "app", "Attempting to stop core through service");

    // 1. 先尝试通过服务正常停止
    let url = format!("{SERVICE_URL}/stop_clash");
    let client = reqwest::ClientBuilder::new()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;

    match client.post(&url).send().await {
        Ok(_) => {
            log::info!(target: "app", "Successfully sent stop request to service");
            // 等待服务停止
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Err(e) => {
            log::error!(target: "app", "Failed to send stop request: {}", e);
        }
    }

    // 2. 强制清理所有进程
    force_kill_service_process().await?;

    Ok(())
}

/// stop the clash-verge-service.
///
/// on MacOS, this will kill all running `mihomi` processes
/// and create a new service with a new PID.
/// It does not REALLY kill the clash-verge-service totally.
/// It relies on clash-verge-service running as a launchctl service.
/// To enable this new service feature, see https://github.com/clash-verge-rev/clash-verge-service/pull/5
/// Related build required.
#[cfg(target_os = "macos")]
pub async fn stop_service_by_service() -> Result<()> {
    log::info!(target: "app", "Attempting to stop service through service");
    let url = format!("{SERVICE_URL}/stop_service");
    let client = reqwest::ClientBuilder::new()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;

    match client.post(&url).send().await {
        Ok(_) => {
            log::info!(target: "app", "Successfully sent stop request to service");
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Err(e) => {
            log::error!(target: "app", "Failed to send stop request: {}", e);
        }
    }

    Ok(())
}
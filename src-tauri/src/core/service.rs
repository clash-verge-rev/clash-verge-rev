use crate::config::Config;
use crate::utils::dirs;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::{env::current_exe, process::Command as StdCommand};

const SERVICE_URL: &str = "http://127.0.0.1:33211";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseBody {
    auto_restart: bool,
    restart_retry_count: u32,
    info: Option<ClashInfo>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct ClashInfo {
    pub core_type: Option<String>,
    pub bin_path: String,
    pub config_dir: String,
    pub config_file: String,
    pub log_file: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
}

/// Install the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
///
#[cfg(target_os = "windows")]
pub async fn install_service() -> Result<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service.exe");

    if !install_path.exists() {
        bail!("installer exe not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;

    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path)
            .arg("--log-dir")
            .arg(log_dir)
            .show(false)
            .status()?,
        _ => StdCommand::new(install_path)
            .arg("--log-dir")
            .arg(log_dir)
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
pub async fn install_service() -> Result<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");
    log::debug!("installer path: {}", installer_path.display());

    if !installer_path.exists() {
        bail!("installer not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    log::debug!("log dir: {}", log_dir.display());

    let elevator = crate::utils::unix_helper::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(installer_path)
            .arg("--log-dir")
            .arg(log_dir.clone())
            .status()?,
        _ => {
            let execute_cmd = format!(
                "{} --log-dir {}",
                installer_path.display(),
                log_dir.display()
            );
            StdCommand::new(elevator)
                .arg("sh")
                .arg("-c")
                .arg(execute_cmd)
                .status()?
        }
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
pub async fn install_service() -> Result<()> {
    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");

    if !installer_path.exists() {
        bail!("installer not found");
    }
    let log_dir = dirs::app_logs_dir()?.join("service");
    let shell = installer_path.to_string_lossy().replace(" ", "\\\\ ");
    let command = format!(
        r#"do shell script "{} --log-dir {}" with administrator privileges"#,
        shell,
        log_dir.display()
    );

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
/// Uninstall the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
#[cfg(target_os = "windows")]
pub async fn uninstall_service() -> Result<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

    if !uninstall_path.exists() {
        bail!("uninstaller exe not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;

    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path)
            .arg("--log-dir")
            .arg(log_dir)
            .show(false)
            .status()?,
        _ => StdCommand::new(uninstall_path)
            .arg("--log-dir")
            .arg(log_dir)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn uninstall_service() -> Result<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        bail!("uninstaller not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let elevator = crate::utils::unix_helper::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(uninstaller_path)
            .arg("--log-dir")
            .arg(log_dir)
            .status()?,
        _ => {
            let execute_cmd = format!(
                "{} --log-dir {}",
                uninstaller_path.display(),
                log_dir.display()
            );
            StdCommand::new(elevator)
                .arg("sh")
                .arg("-c")
                .arg(execute_cmd)
                .status()?
        }
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
pub async fn uninstall_service() -> Result<()> {
    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        bail!("uninstaller not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let shell = uninstaller_path.to_string_lossy().replace(" ", "\\\\ ");
    let command = format!(
        r#"do shell script "{} --log-dir {}" with administrator privileges"#,
        shell,
        log_dir.display()
    );

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
    let url = format!("{SERVICE_URL}/clash");
    let response = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .get(url)
        .send()
        .await
        .context("failed to connect to the Clash Verge Service")?
        .json::<JsonResponse>()
        .await
        .context("failed to parse the Clash Verge Service response")?;

    Ok(response)
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf, log_path: &PathBuf) -> Result<()> {
    check_service().await?;
    stop_core_by_service().await?;

    let clash_core = Config::verge().latest().clash_core.clone();
    let clash_core = clash_core.unwrap_or("verge-mihomo".into());

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let clash_bin = format!("{clash_core}{bin_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;

    let config_file = dirs::path_to_str(config_file)?;

    let mut map = HashMap::new();
    map.insert("core_type", clash_core.as_str());
    map.insert("bin_path", bin_path);
    map.insert("config_dir", config_dir);
    map.insert("config_file", config_file);

    // let log_path = dirs::service_log_file()?;
    let log_path = dirs::path_to_str(&log_path)?;
    map.insert("log_file", log_path);

    let url = format!("{SERVICE_URL}/clash");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .json(&map)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> Result<()> {
    let url = format!("{SERVICE_URL}/clash");
    let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .delete(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    if res.code != 0 {
        bail!(res.msg);
    }

    Ok(())
}

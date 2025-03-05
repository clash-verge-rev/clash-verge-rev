use crate::config::Config;
use crate::utils::dirs;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::{env::current_exe, process::Command as StdCommand};
use tokio::time::Duration;

// Windows only

const SERVICE_URL: &str = "http://127.0.0.1:33211";
const REQUIRED_SERVICE_VERSION: &str = "1.0.1"; // 定义所需的服务版本号

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseBody {
    pub core_type: Option<String>,
    pub bin_path: String,
    pub config_dir: String,
    pub log_file: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionResponse {
    pub service: String,
    pub version: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct VersionJsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<VersionResponse>,
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
    
    // 获取提示文本，如果 i18n 失败则使用硬编码默认值
    let prompt = crate::utils::i18n::t("Service Administrator Prompt");
    let prompt = if prompt == "Service Administrator Prompt" {
        if Config::verge().latest().language.as_deref() == Some("zh") || Config::verge().latest().language.is_none() {
            "Clash Verge 需要使用管理员权限来重新安装系统服务"
        } else {
            "Clash Verge needs administrator privileges to reinstall the system service"
        }
    } else {
        &prompt
    };
    
    let command = format!(
        r#"do shell script "sudo '{uninstall_shell}' && sudo '{install_shell}'" with administrator privileges with prompt "{prompt}""#
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
    let url = format!("{SERVICE_URL}/get_clash");
    let response = reqwest::ClientBuilder::new()
        .no_proxy()
        .timeout(Duration::from_secs(3))
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

/// check the service version
pub async fn check_service_version() -> Result<String> {
    let url = format!("{SERVICE_URL}/version");
    let response = reqwest::ClientBuilder::new()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?
        .get(url)
        .send()
        .await
        .context("failed to connect to the Clash Verge Service")?
        .json::<VersionJsonResponse>()
        .await
        .context("failed to parse the Clash Verge Service version response")?;

    match response.data {
        Some(data) => Ok(data.version),
        None => bail!("service version not found in response"),
    }
}

/// check if service needs to be reinstalled
pub async fn check_service_needs_reinstall() -> bool {
    match check_service_version().await {
        Ok(version) => version != REQUIRED_SERVICE_VERSION,
        Err(_) => true, // 如果无法获取版本或服务未运行，也需要重新安装
    }
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    // 检查服务版本，如果不匹配则重新安装
    if check_service_needs_reinstall().await {
        log::info!(target: "app", "service version mismatch, reinstalling");
        reinstall_service().await?;
    }

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

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> Result<()> {
    let url = format!("{SERVICE_URL}/stop_clash");
    let _ = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await
        .context("failed to connect to the Clash Verge Service")?;

    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_running() -> Result<bool> {
    let resp = check_service().await?;

    // 检查服务状态码和消息
    if resp.code == 200 && resp.msg == "success" && resp.data.is_some() {
        Ok(true)
    } else {
        Ok(false)
    }
}

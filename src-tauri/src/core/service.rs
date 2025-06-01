use crate::config::Config;
use crate::utils::crypto::load_keys;
use crate::utils::{crypto, dirs};
use anyhow::{bail, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::{env::current_exe, process::Command as StdCommand};
use tipsy::ServerId;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum SocketCommand {
    GetVersion,
    GetClash,
    GetLogs,
    StartClash(StartBody),
    StopClash,
    StopService,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StartBody {
    pub core_type: Option<String>,
    pub bin_path: String,
    pub config_dir: String,
    pub config_file: String,
    pub log_file: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ClashStatus {
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
pub struct JsonResponse<T> {
    pub code: u64,
    pub msg: String,
    pub data: Option<T>,
}

impl<T> JsonResponse<T>
where
    T: serde::de::DeserializeOwned,
{
    pub fn from_str(json_str: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json_str)
    }
}

const SERVER_ID: &str = "verge-service-server";

async fn send_command<T: DeserializeOwned>(cmd: SocketCommand) -> Result<JsonResponse<T>> {
    let path = ServerId::new(SERVER_ID).parent_folder(std::env::temp_dir());
    let client = tipsy::Endpoint::connect(path).await?;
    let mut reader = BufReader::new(client);
    // send request
    let cmd_json = serde_json::to_string(&cmd)?;
    let (private_key, public_key) = load_keys()?;
    let combined = crypto::encrypt_socket_data(&public_key, &cmd_json)?;
    reader.write_all(combined.as_bytes()).await?;
    // receive response
    let mut response = String::new();
    reader.read_line(&mut response).await?;
    response = crypto::decrypt_socket_data(&private_key, &response)?;
    let res = JsonResponse::from_str(&response)?;
    Ok(res)
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
    tracing::debug!("installer path: {}", installer_path.display());

    if !installer_path.exists() {
        bail!("installer not found");
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    tracing::debug!("log dir: {}", log_dir.display());

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
pub async fn check_service() -> Result<JsonResponse<ClashStatus>> {
    match send_command::<ClashStatus>(SocketCommand::GetClash).await {
        Ok(res) => {
            if res.code != 0 {
                bail!("socket command [GetClash] return error: {}", res.msg);
            }
            tracing::info!("connect to service success");
            Ok(res)
        }
        Err(_) => {
            tracing::info!("connect to service failed, error");
            Err(anyhow::anyhow!("failed to connect service"))
        }
    }
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf, log_path: &PathBuf) -> Result<()> {
    check_service().await?;
    stop_core_by_service().await?;

    let clash_core = {
        let verge = Config::verge();
        let verge = verge.latest();
        verge.clash_core.clone().unwrap_or("verge-mihomo".into())
    };

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
    let log_path = dirs::path_to_str(log_path)?;
    map.insert("log_file", log_path);

    let body = StartBody {
        core_type: Some(clash_core),
        bin_path: bin_path.to_string(),
        config_dir: config_dir.to_string(),
        config_file: config_file.to_string(),
        log_file: log_path.to_string(),
    };
    tracing::debug!("send start clash socket command, body: {:?}", body);
    let res = send_command::<()>(SocketCommand::StartClash(body)).await?;
    if res.code != 0 {
        bail!("socket command [StartClash] return error: {}", res.msg);
    }

    Ok(())
}

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> Result<()> {
    let res = send_command::<()>(SocketCommand::StopClash).await?;
    if res.code != 0 {
        bail!("socket command [StopClash] return error: {}", res.msg);
    }
    Ok(())
}

pub async fn get_logs() -> Result<JsonResponse<VecDeque<String>>> {
    let res = send_command::<VecDeque<String>>(SocketCommand::GetLogs).await?;
    if res.code != 0 {
        bail!("socket command [GetLogs] return error: {}", res.msg);
    }
    Ok(res)
}

/// stop the service
pub async fn stop_service() -> Result<()> {
    let res = send_command::<()>(SocketCommand::StopService).await?;
    if res.code != 0 {
        bail!("socket command [StopService] return error: {}", res.msg);
    }
    Ok(())
}

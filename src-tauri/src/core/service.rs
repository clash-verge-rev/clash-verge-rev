use crate::MIHOMO_SOCKET_PATH;
use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::utils::{self, crypto, dirs};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
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
    pub socket_path: Option<String>,
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
    pub fn from_str(json_str: &str) -> AppResult<Self> {
        let res = serde_json::from_str(json_str)?;
        Ok(res)
    }
}

const SERVER_ID: &str = "verge-service-server";

async fn send_command<T: DeserializeOwned>(cmd: SocketCommand) -> AppResult<JsonResponse<T>> {
    let path = ServerId::new(SERVER_ID).parent_folder(std::env::temp_dir());
    let client = tipsy::Endpoint::connect(path).await?;
    let mut reader = BufReader::new(client);
    // send request
    let cmd_json = serde_json::to_string(&cmd)?;
    if let Some(public_key) = utils::crypto::get_public_key() {
        let combined = crypto::encrypt_socket_data(&public_key, &cmd_json)?;
        reader.write_all(combined.as_bytes()).await?;
    } else {
        return Err(AppError::LoadKeys("failed to get rsa public key".to_string()));
    }
    // receive response
    let mut response = String::new();
    reader.read_line(&mut response).await?;
    if let Some(private_key) = utils::crypto::get_private_key() {
        response = crypto::decrypt_socket_data(&private_key, &response)?;
        let res = JsonResponse::from_str(&response)?;
        Ok(res)
    } else {
        Err(AppError::LoadKeys("failed to get rsa private key".to_string()))
    }
}

/// Install the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
///
#[cfg(target_os = "windows")]
pub async fn install_service() -> AppResult<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service.exe");

    if !install_path.exists() {
        return Err(AppError::Service("installer not fount".to_string()));
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
        return Err(AppError::Service(format!(
            "failed to install service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn install_service() -> AppResult<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");
    tracing::debug!("installer path: {}", installer_path.display());

    if !installer_path.exists() {
        return Err(AppError::Service("installer not found".to_string()));
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    tracing::debug!("log dir: {}", log_dir.display());

    let elevator = crate::utils::unix_helper::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(installer_path)
            .arg("--log-dir")
            .arg(&log_dir)
            .status()?,
        _ => {
            let execute_cmd = format!("{} --log-dir {}", installer_path.display(), log_dir.display());
            StdCommand::new(elevator)
                .arg("sh")
                .arg("-c")
                .arg(execute_cmd)
                .status()?
        }
    };

    if !status.success() {
        return Err(AppError::Service(format!(
            "failed to install service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn install_service() -> AppResult<()> {
    let binary_path = dirs::service_path()?;
    let installer_path = binary_path.with_file_name("install-service");

    if !installer_path.exists() {
        return Err(AppError::Service("installer not fount".to_string()));
    }
    let log_dir = dirs::app_logs_dir()?.join("service");
    let shell = installer_path.to_string_lossy().replace(" ", "\\\\ ");
    let command = format!(
        r#"do shell script "{} --log-dir {}" with administrator privileges"#,
        shell,
        log_dir.display()
    );

    let status = StdCommand::new("osascript").args(vec!["-e", &command]).status()?;

    if !status.success() {
        return Err(AppError::Service(format!(
            "failed to install service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}
/// Uninstall the Clash Verge Service
/// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
#[cfg(target_os = "windows")]
pub async fn uninstall_service() -> AppResult<()> {
    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

    if !uninstall_path.exists() {
        return Err(AppError::Service("uninstaller not fount".to_string()));
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
        return Err(AppError::Service(format!(
            "failed to uninstall service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn uninstall_service() -> AppResult<()> {
    use users::get_effective_uid;

    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        return Err(AppError::Service("uninstaller not fount".to_string()));
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let elevator = crate::utils::unix_helper::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(uninstaller_path)
            .arg("--log-dir")
            .arg(log_dir)
            .status()?,
        _ => {
            let execute_cmd = format!("{} --log-dir {}", uninstaller_path.display(), log_dir.display());
            StdCommand::new(elevator)
                .arg("sh")
                .arg("-c")
                .arg(execute_cmd)
                .status()?
        }
    };

    if !status.success() {
        return Err(AppError::Service(format!(
            "failed to uninstall service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn uninstall_service() -> AppResult<()> {
    let binary_path = dirs::service_path()?;
    let uninstaller_path = binary_path.with_file_name("uninstall-service");

    if !uninstaller_path.exists() {
        return Err(AppError::Service("uninstaller not fount".to_string()));
    }

    let log_dir = dirs::app_logs_dir()?.join("service");
    let shell = uninstaller_path.to_string_lossy().replace(" ", "\\\\ ");
    let command = format!(
        r#"do shell script "{} --log-dir {}" with administrator privileges"#,
        shell,
        log_dir.display()
    );

    let status = StdCommand::new("osascript").args(vec!["-e", &command]).status()?;

    if !status.success() {
        return Err(AppError::Service(format!(
            "failed to uninstall service with status {:?}",
            status.code()
        )));
    }

    Ok(())
}

/// check the windows service status
pub async fn check_service() -> AppResult<JsonResponse<ClashStatus>> {
    match send_command::<ClashStatus>(SocketCommand::GetClash).await {
        Ok(res) => {
            tracing::info!("connect to service success");
            Ok(res)
        }
        Err(e) => {
            tracing::error!("connect to service failed");
            Err(e)
        }
    }
}

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf, log_path: &PathBuf) -> AppResult<()> {
    check_service().await?;
    stop_core_by_service().await?;

    let clash_core = Config::verge()
        .latest()
        .clash_core
        .clone()
        .unwrap_or("verge-mihomo".to_string());

    let exe_ext = std::env::consts::EXE_SUFFIX;
    let clash_bin = format!("{clash_core}{exe_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;
    let config_file = dirs::path_to_str(config_file)?;
    let log_path = dirs::path_to_str(log_path)?;

    let body = StartBody {
        core_type: Some(clash_core),
        socket_path: Some(MIHOMO_SOCKET_PATH.to_string()),
        bin_path: bin_path.to_string(),
        config_dir: config_dir.to_string(),
        config_file: config_file.to_string(),
        log_file: log_path.to_string(),
    };
    tracing::debug!("send start clash socket command, body: {:?}", body);
    let res = send_command::<()>(SocketCommand::StartClash(body)).await?;
    if res.code != 0 {
        return Err(AppError::Service(format!(
            "socket command [StartClash] return error: {}",
            res.msg
        )));
    }

    Ok(())
}

/// stop the clash by service
pub(super) async fn stop_core_by_service() -> AppResult<()> {
    let res = send_command::<()>(SocketCommand::StopClash).await?;
    if res.code != 0 {
        return Err(AppError::Service(format!(
            "socket command [StopClash] return error: {}",
            res.msg
        )));
    }
    Ok(())
}

pub async fn get_logs() -> AppResult<JsonResponse<VecDeque<String>>> {
    let res = send_command::<VecDeque<String>>(SocketCommand::GetLogs).await?;
    if res.code != 0 {
        return Err(AppError::Service(format!(
            "socket command [GetLogs] return error: {}",
            res.msg
        )));
    }
    Ok(res)
}

/// stop the service
pub async fn stop_service() -> AppResult<()> {
    let res = send_command::<()>(SocketCommand::StopService).await?;
    if res.code != 0 {
        return Err(AppError::Service(format!(
            "socket command [StopService] return error: {}",
            res.msg
        )));
    }
    Ok(())
}

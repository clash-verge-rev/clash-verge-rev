use crate::{
    cache::{CacheService, SHORT_TERM_TTL},
    config::Config,
    core::service_ipc::{IpcCommand, send_ipc_request},
    logging, logging_error,
    utils::{dirs, logging::Type},
};
use anyhow::{Context, Result, bail};
use once_cell::sync::Lazy;
use std::{env::current_exe, path::PathBuf, process::Command as StdCommand};
use tokio::sync::Mutex;

const REQUIRED_SERVICE_VERSION: &str = "1.1.2"; // 定义所需的服务版本号

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    Ready,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    Unavailable(String),
}

#[derive(Clone)]
pub struct ServiceManager(ServiceStatus);

#[allow(clippy::unused_async)]
#[cfg(target_os = "windows")]
async fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "uninstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).show(false).status()?,
        _ => StdCommand::new(uninstall_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[allow(clippy::unused_async)]
#[cfg(target_os = "windows")]
async fn install_service() -> Result<()> {
    logging!(info, Type::Service, true, "install service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service.exe");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path).show(false).status()?,
        _ => StdCommand::new(install_path)
            .creation_flags(0x08000000)
            .status()?,
    };

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
async fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(
            warn,
            Type::Service,
            true,
            "failed to uninstall service: {}",
            err
        );
    }

    // 再安装服务
    match install_service().await {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

#[allow(clippy::unused_async)]
#[cfg(target_os = "linux")]
async fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "uninstall service");
    use users::get_effective_uid;

    let uninstall_path = tauri::utils::platform::current_exe()?.with_file_name("uninstall-service");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

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
    logging!(
        info,
        Type::Service,
        true,
        "uninstall status code:{}",
        status.code().unwrap_or(-1)
    );

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
#[allow(clippy::unused_async)]
async fn install_service() -> Result<()> {
    logging!(info, Type::Service, true, "install service");
    use users::get_effective_uid;

    let install_path = tauri::utils::platform::current_exe()?.with_file_name("install-service");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let status = match get_effective_uid() {
        0 => StdCommand::new(install_shell).status()?,
        _ => StdCommand::new(elevator.clone())
            .arg("sh")
            .arg("-c")
            .arg(install_shell)
            .status()?,
    };
    logging!(
        info,
        Type::Service,
        true,
        "install status code:{}",
        status.code().unwrap_or(-1)
    );

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
async fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(
            warn,
            Type::Service,
            true,
            "failed to uninstall service: {}",
            err
        );
    }

    // 再安装服务
    match install_service().await {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

#[cfg(target_os = "macos")]
async fn uninstall_service() -> Result<()> {
    use crate::utils::i18n::t;

    logging!(info, Type::Service, true, "uninstall service");

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    let prompt = t("Service Administrator Prompt").await;
    let command = format!(
        r#"do shell script "sudo '{uninstall_shell}'" with administrator privileges with prompt "{prompt}""#
    );

    // logging!(debug, Type::Service, true, "uninstall command: {}", command);

    let status = StdCommand::new("osascript")
        .args(vec!["-e", &command])
        .status()?;

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
async fn install_service() -> Result<()> {
    use crate::utils::i18n::t;

    logging!(info, Type::Service, true, "install service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().into_owned();

    let prompt = t("Service Administrator Prompt").await;
    let command = format!(
        r#"do shell script "sudo '{install_shell}'" with administrator privileges with prompt "{prompt}""#
    );

    // logging!(debug, Type::Service, true, "install command: {}", command);

    let status = StdCommand::new("osascript")
        .args(vec!["-e", &command])
        .status()?;

    if !status.success() {
        bail!(
            "failed to install service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
async fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(
            warn,
            Type::Service,
            true,
            "failed to uninstall service: {}",
            err
        );
    }

    // 再安装服务
    match install_service().await {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

/// 强制重装服务（UI修复按钮）
pub async fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "用户请求强制重装服务");
    reinstall_service().await.map_err(|err| {
        logging!(error, Type::Service, true, "强制重装服务失败: {}", err);
        err
    })
}

/// 检查服务版本 - 使用IPC通信
async fn check_service_version() -> Result<String> {
    let cache = CacheService::global();
    let key = CacheService::make_key("service", "version");
    let version_arc = cache
        .get_or_fetch(key, SHORT_TERM_TTL, || async {
            logging!(info, Type::Service, true, "开始检查服务版本 (IPC)");
            let payload = serde_json::json!({});
            let response = send_ipc_request(IpcCommand::GetVersion, payload).await?;

            let data = response
                .data
                .ok_or_else(|| anyhow::anyhow!("服务版本响应中没有数据"))?;

            if let Some(nested_data) = data.get("data")
                && let Some(version) = nested_data.get("version").and_then(|v| v.as_str())
            {
                // logging!(info, Type::Service, true, "获取到服务版本: {}", version);
                return Ok(version.to_string());
            }

            Ok("unknown".to_string())
        })
        .await;

    match version_arc.as_ref() {
        Ok(v) => Ok(v.clone()),
        Err(e) => Err(anyhow::Error::msg(e.to_string())),
    }
}

/// 检查服务是否需要重装
pub async fn check_service_needs_reinstall() -> bool {
    match check_service_version().await {
        Ok(version) => version != REQUIRED_SERVICE_VERSION,
        Err(_) => false,
    }
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, true, "尝试使用现有服务启动核心");

    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_ref().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = current_exe()?.with_file_name(format!("{clash_core}{bin_ext}"));

    let payload = serde_json::json!({
        "core_type": clash_core,
        "bin_path": dirs::path_to_str(&bin_path)?,
        "config_dir": dirs::path_to_str(&dirs::app_home_dir()?)?,
        "config_file": dirs::path_to_str(config_file)?,
        "log_file": dirs::path_to_str(&dirs::service_log_file()?)?,
    });

    let response = send_ipc_request(IpcCommand::StartClash, payload)
        .await
        .context("无法连接到Clash Verge Service")?;

    if !response.success {
        let err_msg = response.error.unwrap_or_else(|| "启动核心失败".to_string());
        bail!(err_msg);
    }

    if let Some(data) = &response.data
        && let Some(code) = data.get("code").and_then(|c| c.as_u64())
        && code != 0
    {
        let msg = data
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        bail!("启动核心失败: {}", msg);
    }

    logging!(info, Type::Service, true, "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, true, "正在尝试通过服务启动核心");

    if check_service_needs_reinstall().await {
        reinstall_service().await?;
    }

    logging!(info, Type::Service, true, "服务已运行且版本匹配，直接使用");
    start_with_existing_service(config_file).await
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service() -> Result<()> {
    logging!(info, Type::Service, true, "通过服务停止核心 (IPC)");

    let payload = serde_json::json!({});
    let response = send_ipc_request(IpcCommand::StopClash, payload)
        .await
        .context("无法连接到Clash Verge Service")?;

    if !response.success {
        let err_msg = response.error.unwrap_or_else(|| "停止核心失败".to_string());
        logging!(error, Type::Service, true, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    if let Some(data) = &response.data
        && let Some(code) = data.get("code")
    {
        let code_value = code.as_u64().unwrap_or(1);
        let msg = data
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");

        if code_value != 0 {
            logging!(
                error,
                Type::Service,
                true,
                "停止核心返回错误: code={}, msg={}",
                code_value,
                msg
            );
            bail!("停止核心失败: {}", msg);
        }
    }

    logging!(info, Type::Service, true, "服务成功停止核心");
    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    check_service_version().await?;
    Ok(())
}

impl ServiceManager {
    pub fn default() -> Self {
        Self(ServiceStatus::Unavailable("Need Checks".into()))
    }

    pub fn current(&self) -> ServiceStatus {
        self.0.clone()
    }

    pub async fn refresh(&mut self) -> Result<()> {
        let status = self.check_service_comprehensive().await;
        logging_error!(
            Type::Service,
            true,
            self.handle_service_status(&status).await
        );
        self.0 = status;
        Ok(())
    }

    /// 综合服务状态检查（一次性完成所有检查）
    pub async fn check_service_comprehensive(&self) -> ServiceStatus {
        match is_service_available().await {
            Ok(_) => {
                logging!(info, Type::Service, true, "服务当前可用，检查是否需要重装");
                if check_service_needs_reinstall().await {
                    logging!(info, Type::Service, true, "服务需要重装且允许重装");
                    ServiceStatus::NeedsReinstall
                } else {
                    ServiceStatus::Ready
                }
            }
            Err(err) => {
                logging!(warn, Type::Service, true, "服务不可用，检查安装状态");
                ServiceStatus::Unavailable(err.to_string())
            }
        }
    }

    /// 根据服务状态执行相应操作
    pub async fn handle_service_status(&mut self, status: &ServiceStatus) -> Result<()> {
        match status {
            ServiceStatus::Ready => {
                logging!(info, Type::Service, true, "服务就绪，直接启动");
                Ok(())
            }
            ServiceStatus::NeedsReinstall | ServiceStatus::ReinstallRequired => {
                logging!(info, Type::Service, true, "服务需要重装，执行重装流程");
                reinstall_service().await?;
                self.0 = ServiceStatus::Ready;
                Ok(())
            }
            ServiceStatus::ForceReinstallRequired => {
                logging!(
                    info,
                    Type::Service,
                    true,
                    "服务需要强制重装，执行强制重装流程"
                );
                force_reinstall_service().await?;
                self.0 = ServiceStatus::Ready;
                Ok(())
            }
            ServiceStatus::InstallRequired => {
                logging!(info, Type::Service, true, "需要安装服务，执行安装流程");
                install_service().await?;
                self.0 = ServiceStatus::Ready;
                Ok(())
            }
            ServiceStatus::UninstallRequired => {
                logging!(info, Type::Service, true, "服务需要卸载，执行卸载流程");
                uninstall_service().await?;
                self.0 = ServiceStatus::Unavailable("Service Uninstalled".into());
                Ok(())
            }
            ServiceStatus::Unavailable(reason) => {
                logging!(
                    info,
                    Type::Service,
                    true,
                    "服务不可用: {}，将使用Sidecar模式",
                    reason
                );
                self.0 = ServiceStatus::Unavailable(reason.clone());
                Err(anyhow::anyhow!("服务不可用: {}", reason))
            }
        }
    }
}

pub static SERVICE_MANAGER: Lazy<Mutex<ServiceManager>> =
    Lazy::new(|| Mutex::new(ServiceManager::default()));

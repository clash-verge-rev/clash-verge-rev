use crate::{
    config::Config,
    core::tray,
    logging, logging_error,
    utils::{dirs, init::service_writer_config, logging::Type},
};
use anyhow::{Context as _, Result, bail};
use clash_verge_service_ipc::CoreConfig;
use compact_str::CompactString;
use once_cell::sync::Lazy;
use std::{
    env::current_exe,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    time::Duration,
};
use tokio::sync::Mutex;

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
    logging!(info, Type::Service, "uninstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("clash-verge-service-uninstall.exe");

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
    logging!(info, Type::Service, "install service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("clash-verge-service-install.exe");

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
    logging!(info, Type::Service, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(warn, Type::Service, "failed to uninstall service: {}", err);
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
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path =
        tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&uninstall_path).status()?
    } else {
        StdCommand::new(elevator)
            .arg("sh")
            .arg("-c")
            .arg(uninstall_shell)
            .status()?
    };
    logging!(
        info,
        Type::Service,
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
    logging!(info, Type::Service, "install service");

    let install_path =
        tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().replace(" ", "\\ ");

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&install_path).status()?
    } else {
        StdCommand::new(elevator)
            .arg("sh")
            .arg("-c")
            .arg(install_shell)
            .status()?
    };
    logging!(
        info,
        Type::Service,
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
    logging!(info, Type::Service, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(warn, Type::Service, "failed to uninstall service: {}", err);
    }

    // 再安装服务
    match install_service().await {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_running_as_root() -> bool {
    const ROOT_UID: u32 = 0;

    unsafe { libc::geteuid() == ROOT_UID }
}

#[cfg(target_os = "macos")]
async fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    crate::utils::i18n::sync_locale().await;

    let prompt = rust_i18n::t!("service.adminPrompt").to_string();
    let command = format!(
        r#"do shell script "sudo '{uninstall_shell}'" with administrator privileges with prompt "{prompt}""#
    );

    // logging!(debug, Type::Service, "uninstall command: {}", command);

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
    logging!(info, Type::Service, "install service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().into_owned();

    crate::utils::i18n::sync_locale().await;

    let prompt = rust_i18n::t!("service.adminPrompt").to_string();
    let command = format!(
        r#"do shell script "sudo '{install_shell}'" with administrator privileges with prompt "{prompt}""#
    );

    // logging!(debug, Type::Service, "install command: {}", command);

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
    logging!(info, Type::Service, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service().await {
        logging!(warn, Type::Service, "failed to uninstall service: {}", err);
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
    logging!(info, Type::Service, "用户请求强制重装服务");
    reinstall_service().await.map_err(|err| {
        logging!(error, Type::Service, "强制重装服务失败: {}", err);
        err
    })
}

/// 检查服务版本 - 使用IPC通信
async fn check_service_version() -> Result<String> {
    let version_arc: Result<String> = {
        logging!(info, Type::Service, "开始检查服务版本 (IPC)");
        let response = clash_verge_service_ipc::get_version()
            .await
            .context("无法连接到Clash Verge Service")?;
        if response.code > 0 {
            let err_msg = response.message;
            logging!(error, Type::Service, "获取服务版本失败: {}", err_msg);
            return Err(anyhow::anyhow!(err_msg));
        }

        let version = response.data.unwrap_or_else(|| "unknown".into());
        Ok(version)
    };

    match version_arc.as_ref() {
        Ok(v) => Ok(v.clone()),
        Err(e) => Err(anyhow::Error::msg(e.to_string())),
    }
}

/// 检查服务是否需要重装
pub async fn check_service_needs_reinstall() -> bool {
    match check_service_version().await {
        Ok(version) => version != clash_verge_service_ipc::VERSION,
        Err(_) => false,
    }
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, "尝试使用现有服务启动核心");

    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_arc().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = current_exe()?.with_file_name(format!("{clash_core}{bin_ext}"));

    let payload = clash_verge_service_ipc::ClashConfig {
        core_config: CoreConfig {
            config_path: dirs::path_to_str(config_file)?.into(),
            core_path: dirs::path_to_str(&bin_path)?.into(),
            config_dir: dirs::path_to_str(&dirs::app_home_dir()?)?.into(),
        },
        log_config: service_writer_config().await?,
    };

    let response = clash_verge_service_ipc::start_clash(&payload)
        .await
        .context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "启动核心失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, "正在尝试通过服务启动核心");

    if check_service_needs_reinstall().await {
        reinstall_service().await?;
    }

    logging!(info, Type::Service, "服务已运行且版本匹配，直接使用");
    start_with_existing_service(config_file).await
}

pub(super) async fn get_clash_logs_by_service() -> Result<Vec<CompactString>> {
    logging!(info, Type::Service, "正在获取服务模式下的 Clash 日志");

    let response = clash_verge_service_ipc::get_clash_logs()
        .await
        .context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(
            error,
            Type::Service,
            "获取服务模式下的 Clash 日志失败: {}",
            err_msg
        );
        bail!(err_msg);
    }

    logging!(info, Type::Service, "成功获取服务模式下的 Clash 日志");
    Ok(response.data.unwrap_or_default())
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service() -> Result<()> {
    logging!(info, Type::Service, "通过服务停止核心 (IPC)");

    let response = clash_verge_service_ipc::stop_clash()
        .await
        .context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    clash_verge_service_ipc::connect().await?;
    Ok(())
}

pub fn is_service_ipc_path_exists() -> bool {
    Path::new(clash_verge_service_ipc::IPC_PATH).exists()
}

impl ServiceManager {
    pub fn default() -> Self {
        Self(ServiceStatus::Unavailable("Need Checks".into()))
    }

    pub const fn config() -> Option<clash_verge_service_ipc::IpcConfig> {
        Some(clash_verge_service_ipc::IpcConfig {
            default_timeout: Duration::from_millis(30),
            retry_delay: Duration::from_millis(250),
            max_retries: 6,
        })
    }

    pub async fn init(&mut self) -> Result<()> {
        if let Err(e) = clash_verge_service_ipc::connect().await {
            self.0 = ServiceStatus::Unavailable("服务连接失败: {e}".to_string());
            return Err(e);
        }
        Ok(())
    }

    pub fn current(&self) -> ServiceStatus {
        self.0.clone()
    }

    pub async fn refresh(&mut self) -> Result<()> {
        let status = self.check_service_comprehensive().await;
        logging_error!(Type::Service, self.handle_service_status(&status).await);
        self.0 = status;
        Ok(())
    }

    /// 综合服务状态检查（一次性完成所有检查）
    pub async fn check_service_comprehensive(&self) -> ServiceStatus {
        match is_service_available().await {
            Ok(_) => {
                logging!(info, Type::Service, "服务当前可用，检查是否需要重装");
                if check_service_needs_reinstall().await {
                    logging!(info, Type::Service, "服务需要重装且允许重装");
                    ServiceStatus::NeedsReinstall
                } else {
                    ServiceStatus::Ready
                }
            }
            Err(err) => {
                logging!(warn, Type::Service, "服务不可用，检查安装状态");
                ServiceStatus::Unavailable(err.to_string())
            }
        }
    }

    /// 根据服务状态执行相应操作
    pub async fn handle_service_status(&mut self, status: &ServiceStatus) -> Result<()> {
        match status {
            ServiceStatus::Ready => {
                logging!(info, Type::Service, "服务就绪，直接启动");
            }
            ServiceStatus::NeedsReinstall | ServiceStatus::ReinstallRequired => {
                logging!(info, Type::Service, "服务需要重装，执行重装流程");
                reinstall_service().await?;
                self.0 = ServiceStatus::Ready;
            }
            ServiceStatus::ForceReinstallRequired => {
                logging!(info, Type::Service, "服务需要强制重装，执行强制重装流程");
                force_reinstall_service().await?;
                self.0 = ServiceStatus::Ready;
            }
            ServiceStatus::InstallRequired => {
                logging!(info, Type::Service, "需要安装服务，执行安装流程");
                install_service().await?;
                self.0 = ServiceStatus::Ready;
            }
            ServiceStatus::UninstallRequired => {
                logging!(info, Type::Service, "服务需要卸载，执行卸载流程");
                uninstall_service().await?;
                self.0 = ServiceStatus::Unavailable("Service Uninstalled".into());
            }
            ServiceStatus::Unavailable(reason) => {
                logging!(
                    info,
                    Type::Service,
                    "服务不可用: {}，将使用Sidecar模式",
                    reason
                );
                self.0 = ServiceStatus::Unavailable(reason.clone());
                return Err(anyhow::anyhow!("服务不可用: {}", reason));
            }
        }
        let _ = tray::Tray::global().update_menu().await;
        Ok(())
    }
}

pub static SERVICE_MANAGER: Lazy<Mutex<ServiceManager>> =
    Lazy::new(|| Mutex::new(ServiceManager::default()));

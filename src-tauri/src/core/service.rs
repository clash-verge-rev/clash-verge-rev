use crate::{
    config::Config,
    core::{
        CoreManager, manager::RunningMode, owner_identity::current_owner_credentials,
        runtime_bundle::collect_runtime_bundle, sysopt::Sysopt, tray::Tray,
    },
    process::AsyncHandler,
    utils::dirs,
    utils::server,
};
use anyhow::{Context as _, Result, bail};
use backon::{ConstantBuilder, Retryable as _};
use clash_verge_logging::{Type, logging};
use compact_str::CompactString;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use scopeguard::defer;
use std::{
    borrow::Cow,
    env::current_exe,
    future::Future,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};
use tokio::sync::Notify;

static OWNER_MONITOR_GENERATION: AtomicU64 = AtomicU64::new(0);

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

pub struct ServiceManager {
    status: Mutex<ServiceStatus>,
    operation_running: AtomicBool,
    operation_done: Notify,
}

fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
    Ok(current_exe()?.with_file_name(format!("{clash_core}{bin_ext}")))
}

/// 卸载服务前以 root 清理残留 core 和 IPC 套接字。
#[cfg(target_os = "macos")]
fn macos_force_stop_core_shell() -> String {
    use crate::config::IVerge;

    // 只清理 root 拥有的服务内核。
    let mut parts: Vec<String> = IVerge::VALID_CLASH_CORES
        .iter()
        .map(|core| format!("/usr/bin/pkill -U root -x {core} 2>/dev/null || true"))
        .collect();

    if let Ok(ipc) = dirs::ipc_path()
        && let Ok(ipc_str) = dirs::path_to_str(&ipc)
    {
        // 转义单引号,避免破坏 shell 参数。
        let escaped = ipc_str.replace('\'', r"'\''");
        parts.push(format!("/bin/rm -f '{escaped}' 2>/dev/null || true"));
    }

    parts.join("; ")
}

#[cfg(target_os = "macos")]
fn escape_osascript_double_quoted_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(target_os = "windows")]
fn uninstall_service() -> Result<()> {
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
        _ => StdCommand::new(uninstall_path).creation_flags(0x08000000).status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn install_service() -> Result<()> {
    use std::process::Output;
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
    let output = match level {
        PrivilegeLevel::NotPrivileged => {
            let status = RunasCommand::new(&install_path).show(false).status()?;
            Output {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }
        }
        _ => {
            // StdCommand returns Output directly
            StdCommand::new(&install_path).creation_flags(0x08000000).output()?
        }
    };

    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path = tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&uninstall_path).status()?
    } else {
        let result = StdCommand::new(&elevator).arg(&uninstall_path).status()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.code().unwrap_or(-1)
            );
            StdCommand::new("sudo").arg(&uninstall_path).status()?
        } else {
            result
        }
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
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let install_path = tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let output = if linux_running_as_root() {
        StdCommand::new(&install_path).output()?
    } else {
        let result = StdCommand::new(&elevator).arg(&install_path).output()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.status.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.status.code().unwrap_or(-1)
            );
            StdCommand::new("sudo").arg(&install_path).output()?
        } else {
            result
        }
    };

    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_running_as_root() -> bool {
    use crate::core::handle;
    use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;
    let app_handle = handle::Handle::app_handle();
    is_current_app_handle_admin(app_handle)
}

#[cfg(target_os = "macos")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("clash-verge-service-uninstall");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    // clash_verge_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let prompt = clash_verge_i18n::t!("service.adminUninstallPrompt");
    // 先清理服务残留,再执行卸载器。
    let uninstall_quoted = shell_single_quote(&uninstall_shell);
    let shell = format!("{}; sudo {uninstall_quoted}", macos_force_stop_core_shell());
    let shell = escape_osascript_double_quoted_string(&shell);
    let command = format!(r#"do shell script "{shell}" with administrator privileges with prompt "{prompt}""#);

    // logging!(debug, Type::Service, "uninstall command: {}", command);

    let status = StdCommand::new("osascript").args(vec!["-e", &command]).status()?;

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("clash-verge-service-install");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().into_owned();

    // clash_verge_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let gid = tauri_plugin_clash_verge_sysinfo::current_gid();
    let prompt = clash_verge_i18n::t!("service.adminInstallPrompt");
    let install_quoted = shell_single_quote(&install_shell);
    let shell = format!("sudo CLASH_VERGE_SERVICE_GID={gid} {install_quoted}");
    let shell = escape_osascript_double_quoted_string(&shell);
    let command = format!(r#"do shell script "{shell}" with administrator privileges with prompt "{prompt}""#);

    let output = StdCommand::new("osascript").args(vec!["-e", &command]).output()?;
    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

fn check_output_error(output: &std::process::Output) -> Option<(i32, Cow<'_, str>)> {
    if output.status.success() {
        return None;
    }
    let code = output.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        return Some((code, stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.is_empty() {
        return Some((code, stdout));
    }
    Some((code, Cow::Borrowed("Unknown error")))
}

fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "reinstall service");

    // 先卸载服务
    if let Err(err) = uninstall_service() {
        logging!(warn, Type::Service, "failed to uninstall service: {}", err);
    }

    // 再安装服务
    match install_service() {
        Ok(_) => Ok(()),
        Err(err) => {
            bail!(format!("failed to install service: {err}"))
        }
    }
}

/// 强制重装服务（UI修复按钮）
fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "用户请求强制重装服务");
    reinstall_service().map_err(|err| {
        logging!(error, Type::Service, "强制重装服务失败: {}", err);
        err
    })
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &Path) -> Result<()> {
    logging!(info, Type::Service, "尝试使用现有服务启动核心");

    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_arc().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = service_core_path(&clash_core, bin_ext)?;

    let credentials = current_owner_credentials()?;
    let payload = collect_runtime_bundle(config_file, &bin_path).await?;

    let response = match clash_verge_service_ipc::start_clash(&credentials, &payload).await {
        Ok(response) => response,
        Err(error) => {
            start_owner_monitor();
            return Err(error).context("无法连接到Clash Verge Service");
        }
    };

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "启动核心失败: {}", err_msg);
        start_owner_monitor();
        bail!(err_msg);
    }

    server::set_pac_available(true);
    start_owner_monitor();
    logging!(info, Type::Service, "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &Path) -> Result<()> {
    logging!(info, Type::Service, "正在尝试通过服务启动核心");

    SERVICE_MANAGER.refresh().await?;

    logging!(info, Type::Service, "服务已运行且版本匹配，直接使用");
    start_with_existing_service(config_file).await
}

pub(super) async fn get_clash_logs_by_service() -> Result<Vec<CompactString>> {
    logging!(info, Type::Service, "正在获取服务模式下的 Clash 日志");

    let credentials = current_owner_credentials()?;
    let response = clash_verge_service_ipc::get_clash_logs(&credentials)
        .await
        .context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
            recover_after_owner_loss(OWNER_MONITOR_GENERATION.load(Ordering::Acquire)).await;
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "获取服务模式下的 Clash 日志失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "成功获取服务模式下的 Clash 日志");
    Ok(response.data.unwrap_or_default())
}

pub(crate) async fn get_clash_log_snapshot_by_service() -> Result<String> {
    let credentials = current_owner_credentials()?;
    let response = clash_verge_service_ipc::get_clash_log_snapshot(&credentials)
        .await
        .context("无法连接到Clash Verge Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    let encoded = response.data.context("服务未返回核心日志快照")?;
    if encoded.len() % 2 != 0 {
        bail!("服务返回了无效的核心日志快照");
    }
    let mut content = Vec::with_capacity(encoded.len() / 2);
    for offset in (0..encoded.len()).step_by(2) {
        content.push(u8::from_str_radix(&encoded[offset..offset + 2], 16).context("服务返回了无效的核心日志快照")?);
    }
    Ok(String::from_utf8_lossy(&content).into_owned())
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service() -> Result<()> {
    logging!(info, Type::Service, "通过服务停止核心 (IPC)");

    let credentials = current_owner_credentials()?;
    let response = clash_verge_service_ipc::stop_clash(&credentials)
        .await
        .context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
            cancel_owner_monitors();
            recover_after_owner_loss_while_locked().await;
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

fn owner_status_requires_recovery(
    is_active: bool,
    desired_running: bool,
    service_state: clash_verge_service_ipc::ServiceLifecycleState,
    core_pid: Option<u32>,
    missing_core_samples: u8,
) -> bool {
    !is_active
        || !desired_running
        || service_state == clash_verge_service_ipc::ServiceLifecycleState::Fatal
        || (!matches!(
            service_state,
            clash_verge_service_ipc::ServiceLifecycleState::Starting
                | clash_verge_service_ipc::ServiceLifecycleState::RecoveringCore
        ) && core_pid.is_none()
            && missing_core_samples >= 3)
}

fn start_owner_monitor() {
    let generation = OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    AsyncHandler::spawn(move || async move {
        let mut missing_core_samples = 0u8;
        let mut failed_status_samples = 0u8;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            if !matches!(*CoreManager::global().get_running_mode(), RunningMode::Service) {
                break;
            }
            let response = match current_owner_credentials() {
                Ok(credentials) => clash_verge_service_ipc::get_status(&credentials).await,
                Err(error) => Err(error),
            };
            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    failed_status_samples = failed_status_samples.saturating_add(1);
                    if failed_status_samples == 3 {
                        logging!(
                            warn,
                            Type::Service,
                            "service owner status temporarily unavailable; preserving local proxy state: {error:#}"
                        );
                    }
                    continue;
                }
            };
            if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
                recover_after_owner_loss(generation).await;
                break;
            }
            if response.code != 0 {
                failed_status_samples = failed_status_samples.saturating_add(1);
                if failed_status_samples == 3 {
                    logging!(
                        warn,
                        Type::Service,
                        "service owner status returned error {}; preserving local proxy state: {}",
                        response.code,
                        response.message
                    );
                }
                continue;
            }
            let Some(status) = response.data else {
                failed_status_samples = failed_status_samples.saturating_add(1);
                if failed_status_samples == 3 {
                    logging!(
                        warn,
                        Type::Service,
                        "service owner status omitted data; preserving local proxy state"
                    );
                }
                continue;
            };
            failed_status_samples = 0;
            missing_core_samples = if status.core_pid.is_none()
                && !matches!(
                    status.service_state,
                    clash_verge_service_ipc::ServiceLifecycleState::Starting
                        | clash_verge_service_ipc::ServiceLifecycleState::RecoveringCore
                ) {
                missing_core_samples.saturating_add(1)
            } else {
                0
            };
            if owner_status_requires_recovery(
                status.is_active,
                status.desired_core_should_be_running,
                status.service_state,
                status.core_pid,
                missing_core_samples,
            ) {
                recover_after_owner_loss(generation).await;
                break;
            }
        }
    });
}

fn cancel_owner_monitors() {
    OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel);
}

async fn recover_after_owner_loss(generation: u64) {
    let manager = CoreManager::global();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != generation
        || !matches!(*manager.get_running_mode(), RunningMode::Service)
    {
        return;
    }
    cancel_owner_monitors();
    recover_after_owner_loss_while_locked().await;
}

async fn recover_after_owner_loss_while_locked() {
    logging!(
        warn,
        Type::Service,
        "service owner lost; clearing local proxy and PAC state"
    );
    server::set_pac_available(false);
    CoreManager::global().set_running_mode(RunningMode::NotRunning);
    let mut last_error = None;
    for _ in 0..3 {
        match Sysopt::global().reset_sysproxy().await {
            Ok(()) => return,
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    if let Some(error) = last_error {
        logging!(
            error,
            Type::Service,
            "failed to clear local proxy after owner loss: {error}"
        );
    }
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    if let Err(e) = Path::metadata(clash_verge_service_ipc::IPC_PATH.as_ref()) {
        let verge = Config::verge().await;
        let verge_last = verge.latest_arc();
        let is_enable = verge_last.enable_tun_mode.unwrap_or(false);
        if is_enable {
            logging!(warn, Type::Service, "Some issue with service IPC Path: {}", e);
        }
        return Err(e.into());
    }
    clash_verge_service_ipc::connect().await?;
    Ok(())
}

async fn wait_for_service_ipc(manager: &ServiceManager) -> Result<()> {
    let config = ServiceManager::config();

    let backoff = ConstantBuilder::default()
        .with_delay(config.retry_delay)
        .with_max_times(config.max_retries);

    let result = (|| async {
        if !is_service_ipc_path_exists() {
            bail!("IPC path not ready");
        }
        clash_verge_service_ipc::connect().await.map(drop)
    })
    .retry(backoff)
    .await;

    if result.is_ok() {
        manager.set_status(ServiceStatus::Ready);
    } else {
        manager.set_status(ServiceStatus::Unavailable("Waiting for service to be available".into()));
    }

    result
}

pub fn is_service_ipc_path_exists() -> bool {
    Path::new(clash_verge_service_ipc::IPC_PATH).exists()
}

impl ServiceManager {
    pub const fn config() -> clash_verge_service_ipc::IpcConfig {
        clash_verge_service_ipc::IpcConfig {
            default_timeout: Duration::from_millis(150),
            retry_delay: Duration::from_millis(250),
            max_retries: 20,
        }
    }

    pub async fn init(&self) -> Result<()> {
        if let Err(e) = clash_verge_service_ipc::connect().await {
            self.set_status(ServiceStatus::Unavailable("服务连接失败: {e}".to_string()));
            return Err(e);
        }
        Ok(())
    }

    pub async fn current(&self) -> ServiceStatus {
        loop {
            let notified = self.operation_done.notified();
            if !self.operation_running.load(Ordering::Acquire) {
                let status = self.status.lock().clone();
                if !self.operation_running.load(Ordering::Acquire) {
                    return status;
                }
            }
            notified.await;
        }
    }

    fn set_status(&self, status: ServiceStatus) {
        *self.status.lock() = status;
    }

    async fn run_operation(&self, operation: impl Future<Output = Result<()>>) -> Result<()> {
        {
            if self.operation_running.swap(true, Ordering::AcqRel) {
                bail!("service operation already running");
            }
            defer! {
                self.operation_running.store(false, Ordering::Release);
                self.operation_done.notify_waiters();
            }

            operation.await?;
        }

        Tray::global().update_menu().await
    }

    pub async fn refresh(&self) -> Result<()> {
        self.run_operation(async {
            self.apply_service_status(if clash_verge_service_ipc::is_reinstall_service_needed().await {
                ServiceStatus::NeedsReinstall
            } else {
                ServiceStatus::Ready
            })
            .await
        })
        .await
    }

    pub async fn handle_service_status(&self, status: ServiceStatus) -> Result<()> {
        self.run_operation(self.apply_service_status(status)).await
    }

    async fn apply_service_status(&self, status: ServiceStatus) -> Result<()> {
        self.set_status(status.clone());
        match status {
            ServiceStatus::Ready => logging!(info, Type::Service, "服务就绪，直接启动"),
            ServiceStatus::NeedsReinstall | ServiceStatus::ReinstallRequired => {
                logging!(info, Type::Service, "服务需要重装，执行重装流程");
                run_service_command(reinstall_service, "reinstall service")?;
                wait_for_service_ipc(self).await?;
            }
            ServiceStatus::ForceReinstallRequired => {
                logging!(info, Type::Service, "服务需要强制重装，执行强制重装流程");
                run_service_command(force_reinstall_service, "force reinstall service")?;
                wait_for_service_ipc(self).await?;
            }
            ServiceStatus::InstallRequired => {
                logging!(info, Type::Service, "需要安装服务，执行安装流程");
                run_service_command(install_service, "install service")?;
                wait_for_service_ipc(self).await?;
                if clash_verge_service_ipc::is_reinstall_service_needed().await {
                    logging!(info, Type::Service, "服务版本不匹配，执行重装流程");
                    self.set_status(ServiceStatus::NeedsReinstall);
                    run_service_command(reinstall_service, "reinstall service")?;
                    wait_for_service_ipc(self).await?;
                }
            }
            ServiceStatus::UninstallRequired => {
                logging!(info, Type::Service, "服务需要卸载，执行卸载流程");
                run_service_command(uninstall_service, "uninstall service")?;
                self.set_status(ServiceStatus::Unavailable("Service Uninstalled".into()));
            }
            ServiceStatus::Unavailable(reason) => {
                logging!(info, Type::Service, "服务不可用: {}，将使用Sidecar模式", reason);
                bail!("服务不可用: {}", reason);
            }
        }

        Ok(())
    }
}

fn run_service_command(operation: impl FnOnce() -> Result<()>, label: &'static str) -> Result<()> {
    tokio::task::block_in_place(operation).with_context(|| format!("{label} failed"))
}

pub static SERVICE_MANAGER: Lazy<ServiceManager> = Lazy::new(|| ServiceManager {
    status: Mutex::new(ServiceStatus::Unavailable("Need Checks".into())),
    operation_running: AtomicBool::new(false),
    operation_done: Notify::new(),
});

#[cfg(test)]
mod tests {
    use super::owner_status_requires_recovery;
    use clash_verge_service_ipc::ServiceLifecycleState;

    #[test]
    fn owner_loss_or_sustained_missing_core_requires_local_proxy_recovery() {
        assert!(owner_status_requires_recovery(
            false,
            true,
            ServiceLifecycleState::Running,
            Some(42),
            0
        ));
        assert!(owner_status_requires_recovery(
            true,
            false,
            ServiceLifecycleState::Running,
            None,
            1
        ));
        assert!(!owner_status_requires_recovery(
            true,
            true,
            ServiceLifecycleState::Running,
            None,
            2
        ));
        assert!(owner_status_requires_recovery(
            true,
            true,
            ServiceLifecycleState::Running,
            None,
            3
        ));
        assert!(!owner_status_requires_recovery(
            true,
            true,
            ServiceLifecycleState::RecoveringCore,
            None,
            u8::MAX
        ));
        assert!(owner_status_requires_recovery(
            true,
            true,
            ServiceLifecycleState::Fatal,
            None,
            0
        ));
        assert!(!owner_status_requires_recovery(
            true,
            true,
            ServiceLifecycleState::Running,
            Some(42),
            3
        ));
    }
}

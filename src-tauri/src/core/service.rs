use crate::{
    config::{Config, IClashTemp},
    core::{logger::Logger, tray::Tray},
    utils::dirs,
};
use anyhow::{Context as _, Result, bail};
use backon::{ConstantBuilder, Retryable as _};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::CoreConfig;
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
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::sync::Notify;

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

#[cfg(not(target_os = "macos"))]
fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
    Ok(current_exe()?.with_file_name(format!("{clash_core}{bin_ext}")))
}

#[cfg(target_os = "macos")]
fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
    let binary_name = format!("{clash_core}{bin_ext}");
    let exe_path = current_exe()?;
    let candidate = exe_path.with_file_name(&binary_name);

    if !is_macos_app_translocated(&exe_path) {
        return Ok(candidate);
    }

    if let Some(stable_path) = stable_macos_core_path_for_translocated_app(&exe_path, &binary_name) {
        logging!(
            warn,
            Type::Service,
            "macOS App Translocation detected for core path {:?}; using stable installed path {:?}",
            candidate,
            stable_path
        );
        return Ok(stable_path);
    }

    // 给用户一个可操作的提示,再 bail 让服务启动失败 —— 避免用临时路径起内核。
    notify_translocated_core_path();
    bail!(
        "macOS App Translocation detected; refusing to start service with temporary core path {:?}",
        candidate
    )
}

/// 发送 translocation 用户提示。**延迟**发送:app 启动期会自动尝试起 core,此时前端的
/// `verge://notice-message` 监听器(随 React 布局挂载后才注册)可能尚未就绪,而后端 emit
/// 没有重放队列 —— 立即发会丢失。延迟到前端挂载后再发,既覆盖"启动自动起 core 失败"、
/// 也兼顾手动启动(错误提示略迟可接受)。复用前端 `set_config::error` 处理器直接展示该消息。
#[cfg(target_os = "macos")]
fn notify_translocated_core_path() {
    crate::process::AsyncHandler::spawn(|| async {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        crate::core::handle::Handle::notice_message(
            "set_config::error",
            clash_verge_i18n::t!("service.translocatedCorePath").to_string(),
        );
    });
}

#[cfg(target_os = "macos")]
fn is_macos_app_translocated(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == "AppTranslocation")
}

#[cfg(target_os = "macos")]
fn stable_macos_core_path_for_translocated_app(exe_path: &Path, binary_name: &str) -> Option<PathBuf> {
    let bundle_name = macos_app_bundle_name(exe_path)?;
    macos_core_path_in_install_roots(
        &bundle_name,
        binary_name,
        [Path::new("/Applications"), Path::new("/Applications/Utilities")],
    )
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_name(path: &Path) -> Option<std::ffi::OsString> {
    path.ancestors().find_map(|ancestor| {
        let is_app_bundle = ancestor
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));

        if is_app_bundle {
            ancestor.file_name().map(std::ffi::OsString::from)
        } else {
            None
        }
    })
}

#[cfg(target_os = "macos")]
fn macos_core_path_in_install_roots<'a>(
    bundle_name: &std::ffi::OsStr,
    binary_name: &str,
    install_roots: impl IntoIterator<Item = &'a Path>,
) -> Option<PathBuf> {
    install_roots.into_iter().find_map(|root| {
        let core_path = root
            .join(Path::new(bundle_name))
            .join("Contents")
            .join("MacOS")
            .join(binary_name);

        core_path.is_file().then_some(core_path)
    })
}

#[cfg(target_os = "macos")]
const fn macos_cleanup_translocated_desired_state_shell() -> &'static str {
    "for f in '/var/root/.local/state/clash-verge-service/desired-state.json' '/var/lib/clash-verge-service/desired-state.json'; do if [ -f \"$f\" ] && /usr/bin/grep -q AppTranslocation \"$f\"; then backup=\"$f.apptranslocation.bak\"; if [ -e \"$backup\" ]; then backup=\"$f.apptranslocation.$(/bin/date +%s).bak\"; fi; /bin/mv \"$f\" \"$backup\"; fi; done"
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
    let shell = format!(
        "{}; sudo CLASH_VERGE_SERVICE_GID={gid} {install_quoted}",
        macos_cleanup_translocated_desired_state_shell()
    );
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
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, "尝试使用现有服务启动核心");

    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_arc().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = service_core_path(&clash_core, bin_ext)?;

    let payload = clash_verge_service_ipc::ClashConfig {
        core_config: CoreConfig {
            config_path: dirs::path_to_str(config_file)?.into(),
            core_path: dirs::path_to_str(&bin_path)?.into(),
            core_ipc_path: IClashTemp::guard_external_controller_ipc(),
            config_dir: dirs::path_to_str(&dirs::app_home_dir()?)?.into(),
        },
        log_config: Logger::global().service_writer_config()?,
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

    SERVICE_MANAGER.refresh().await?;

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
        logging!(error, Type::Service, "获取服务模式下的 Clash 日志失败: {}", err_msg);
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> std::io::Result<PathBuf> {
        let path = std::env::temp_dir().join(format!("clash-verge-service-path-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path)?;
        Ok(path)
    }

    #[test]
    fn detects_app_translocation_paths() {
        let path = Path::new(
            "/private/var/folders/example/T/AppTranslocation/123/d/Clash Verge.app/Contents/MacOS/Clash Verge",
        );

        assert!(is_macos_app_translocated(path));
    }

    #[test]
    fn extracts_app_bundle_name_from_executable_path() {
        let path = Path::new("/Applications/Clash Verge.app/Contents/MacOS/Clash Verge");

        assert_eq!(
            macos_app_bundle_name(path).as_deref(),
            Some(std::ffi::OsStr::new("Clash Verge.app"))
        );
    }

    #[test]
    fn resolves_existing_core_path_from_install_roots() -> std::io::Result<()> {
        let root = test_dir("resolve-existing-core-path")?;
        let core_dir = root.join("Clash Verge.app").join("Contents").join("MacOS");
        let core_path = core_dir.join("verge-mihomo");

        fs::create_dir_all(&core_dir)?;
        fs::write(&core_path, b"")?;

        let resolved = macos_core_path_in_install_roots(
            std::ffi::OsStr::new("Clash Verge.app"),
            "verge-mihomo",
            [root.as_path()],
        );

        assert_eq!(resolved, Some(core_path));

        fs::remove_dir_all(root)?;
        Ok(())
    }
}

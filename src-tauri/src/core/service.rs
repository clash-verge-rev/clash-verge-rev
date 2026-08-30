#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::utils::dirs;
use crate::{
    config::Config,
    core::{
        CoreManager,
        handle::Handle,
        manager::RunningMode,
        owner_identity::current_owner_credentials,
        proxy_control,
        runstate::{
            OwnerRecoveryReason, OwnerSample, OwnerStep, OwnerWatch, PendingAction, RUN_STATE, ReadyWaitError,
            RunState, RunStateEnv, RunStateStore, ServiceHealth,
        },
        runtime_bundle::collect_runtime_bundle,
        tray::Tray,
    },
    process::AsyncHandler,
};
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::{
    MacosProxyConfig, OwnerSessionProof, ProxyApplyOutcome, RuntimeBundle, ServiceErrorCode, StageRuntimeOutcome,
    StartClashRequest, WriterConfig,
};
use compact_str::CompactString;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::{
    borrow::Cow,
    env::current_exe,
    future::Future,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

static OWNER_MONITOR_GENERATION: AtomicU64 = AtomicU64::new(0);
static ACTIVE_SERVICE_SESSION: Lazy<Mutex<Option<ActiveServiceSession>>> = Lazy::new(|| Mutex::new(None));

/// Capabilities of the service session that owns the running Core.
/// They are discarded with that session rather than cached across service upgrades.
#[derive(Clone)]
struct ActiveServiceSession {
    proof: OwnerSessionProof,
    supports_runtime_staging: bool,
}

fn generate_service_session_token() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).context("failed to generate service owner session")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(crate) fn active_service_session() -> Result<OwnerSessionProof> {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .map(|session| session.proof.clone())
        .context("service owner session is not active")
}

/// Returns false unless the active service session explicitly supports in-place staging.
pub(crate) fn active_service_supports_runtime_staging() -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session.supports_runtime_staging)
}

pub(crate) fn clear_active_service_session() {
    ACTIVE_SERVICE_SESSION.lock().take();
}

/// Probes staging support without failing startup when the fast path is unavailable.
async fn probe_runtime_staging_support() -> bool {
    match clash_verge_service_ipc::get_version().await {
        Ok(response) if response.code == 0 => response
            .data
            .as_ref()
            .is_some_and(clash_verge_service_ipc::ProtocolInfo::supports_runtime_staging),
        Ok(response) => {
            logging!(
                warn,
                Type::Service,
                "服务协议查询返回 {}: {}；配置变更将走重启路径",
                response.code,
                response.message
            );
            false
        }
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "无法查询服务协议版本: {error:#}；配置变更将走重启路径"
            );
            false
        }
    }
}

fn session_matches_status(proof: &OwnerSessionProof, is_active: bool, active_generation: Option<u64>) -> bool {
    is_active && active_generation == Some(proof.generation)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    Checking,
    Ready,
    NotInstalled,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    SidecarAllowed,
    Unavailable(String),
}

impl ServiceStatus {
    /// Flattens Run State using legacy precedence: action, Sidecar allowance, then health.
    fn from_run_state(state: &RunState) -> Self {
        if let Some(action) = state.pending {
            return match action {
                PendingAction::Install => Self::InstallRequired,
                PendingAction::Uninstall => Self::UninstallRequired,
                PendingAction::Reinstall => Self::ReinstallRequired,
                PendingAction::ForceReinstall => Self::ForceReinstallRequired,
            };
        }
        if state.sidecar_allowed {
            return Self::SidecarAllowed;
        }
        match &state.health {
            ServiceHealth::Unknown => Self::Checking,
            ServiceHealth::Ready => Self::Ready,
            ServiceHealth::NotInstalled => Self::NotInstalled,
            ServiceHealth::VersionMismatch => Self::NeedsReinstall,
            ServiceHealth::Unavailable(reason) => Self::Unavailable(reason.clone()),
        }
    }
}

#[cfg(target_os = "macos")]
fn path_entry_exists_without_follow(path: &Path) -> std::io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn macos_service_install_markers() -> Vec<String> {
    vec![
        format!(
            "/Library/LaunchDaemons/{}.plist",
            clash_verge_service_ipc::MACOS_SERVICE_ID
        ),
        format!(
            "/Library/PrivilegedHelperTools/{}.bundle",
            clash_verge_service_ipc::MACOS_SERVICE_ID
        ),
        #[cfg(not(feature = "verge-dev"))]
        "/Library/LaunchDaemons/io.github.clashverge.helper.plist".to_owned(),
        #[cfg(not(feature = "verge-dev"))]
        "/Library/PrivilegedHelperTools/io.github.clashverge.helper".to_owned(),
    ]
}

#[cfg(target_os = "macos")]
fn macos_service_install_marker_exists() -> std::io::Result<bool> {
    for marker in macos_service_install_markers() {
        if path_entry_exists_without_follow(Path::new(&marker))? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    use windows_service::{
        Error as WindowsServiceError,
        service::ServiceAccess,
        service_manager::{ServiceManager as WindowsServiceManager, ServiceManagerAccess},
    };

    const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
    let manager = WindowsServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(
        clash_verge_service_ipc::WINDOWS_SERVICE_NAME,
        ServiceAccess::QUERY_STATUS,
    ) {
        Ok(service) => {
            drop(service);
            Ok(true)
        }
        Err(WindowsServiceError::Winapi(error)) if error.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST) => {
            Ok(false)
        }
        Err(error) => Err(error).context("failed to inspect Windows service registration"),
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    let unit = format!("{}.service", clash_verge_service_ipc::SERVICE_SLUG);
    let output = StdCommand::new("systemctl")
        .args(["show", "--property=LoadState", "--value", &unit])
        .output()
        .context("failed to inspect systemd service registration")?;
    if !output.status.success() {
        bail!(
            "systemd service registration probe failed with status {}",
            output.status
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() != "not-found")
}

#[cfg(target_os = "macos")]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    macos_service_install_marker_exists().context("failed to inspect launchd service registration")
}

/// Stateless legacy façade over [`RUN_STATE`] retained for existing call sites.
pub struct ServiceManager;

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
static SERVICE_CORE_STAGING_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
fn create_service_core_staging_file(directory: &Path, core_name: &std::ffi::OsStr) -> Result<(PathBuf, std::fs::File)> {
    for _ in 0..32 {
        let generation = SERVICE_CORE_STAGING_GENERATION.fetch_add(1, Ordering::Relaxed);
        let temporary_name = format!(
            ".{}.{}.{generation}.tmp",
            core_name.to_string_lossy(),
            std::process::id()
        );
        let temporary_path = directory.join(temporary_name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to create temporary development Service core {}",
                        temporary_path.display()
                    )
                });
            }
        }
    }

    bail!(
        "failed to create a unique temporary development Service core in {}",
        directory.display()
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
fn service_core_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
    service_core_path_for_with_publisher(
        source,
        home,
        stage_for_macos_dev,
        "service-core",
        |temporary_path, final_path| {
            std::fs::rename(temporary_path, final_path).with_context(|| {
                format!(
                    "failed to publish development Service core {} over {}",
                    temporary_path.display(),
                    final_path.display()
                )
            })
        },
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), all(test, unix)))]
fn service_tool_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
    service_core_path_for_with_publisher(
        source,
        home,
        stage_for_macos_dev,
        "service-tools",
        |temporary_path, final_path| {
            std::fs::rename(temporary_path, final_path).with_context(|| {
                format!(
                    "failed to publish development Service tool {} over {}",
                    temporary_path.display(),
                    final_path.display()
                )
            })
        },
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
#[cfg_attr(not(unix), allow(unreachable_code, unused_assignments, unused_variables))]
fn service_core_path_for_with_publisher<F>(
    source: &Path,
    home: Option<&Path>,
    stage_for_macos_dev: bool,
    staging_directory_name: &str,
    publisher: F,
) -> Result<PathBuf>
where
    F: FnOnce(&Path, &Path) -> Result<()>,
{
    if !stage_for_macos_dev {
        return Ok(source.to_path_buf());
    }

    let home = home
        .filter(|path| !path.as_os_str().is_empty())
        .context("HOME is unavailable for development Service core staging")?;
    let core_name = source
        .file_name()
        .filter(|name| !name.is_empty())
        .with_context(|| format!("development Service core source has no file name: {}", source.display()))?;
    let source_metadata = std::fs::symlink_metadata(source)
        .with_context(|| format!("failed to inspect development Service core source {}", source.display()))?;
    if !source_metadata.file_type().is_file() {
        bail!(
            "development Service core source is not an ordinary file: {}",
            source.display()
        );
    }
    let mut source_file = std::fs::File::open(source)
        .with_context(|| format!("failed to open development Service core source {}", source.display()))?;

    let staging_directory = home
        .join("Applications/.clash-verge-rev-dev")
        .join(staging_directory_name);
    std::fs::create_dir_all(&staging_directory).with_context(|| {
        format!(
            "failed to create development Service core staging directory {}",
            staging_directory.display()
        )
    })?;
    let final_path = staging_directory.join(core_name);
    let (temporary_path, mut temporary_file) = create_service_core_staging_file(&staging_directory, core_name)?;

    let publish_result = (|| -> Result<()> {
        std::io::copy(&mut source_file, &mut temporary_file).with_context(|| {
            format!(
                "failed to copy development Service core from {} to {}",
                source.display(),
                temporary_path.display()
            )
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;

            let mut permissions = temporary_file
                .metadata()
                .with_context(|| format!("failed to inspect temporary Service core {}", temporary_path.display()))?
                .permissions();
            permissions.set_mode(0o755);
            temporary_file.set_permissions(permissions).with_context(|| {
                format!(
                    "failed to set executable permissions on temporary Service core {}",
                    temporary_path.display()
                )
            })?;
        }
        #[cfg(not(unix))]
        bail!("development Service core staging requires Unix executable permissions");

        temporary_file
            .sync_all()
            .with_context(|| format!("failed to sync temporary Service core {}", temporary_path.display()))?;
        drop(temporary_file);
        publisher(&temporary_path, &final_path)?;
        Ok(())
    })();

    if let Err(error) = publish_result {
        match std::fs::remove_file(&temporary_path) {
            Ok(()) => return Err(error),
            Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => return Err(error),
            Err(cleanup_error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to clean temporary development Service core {}: {cleanup_error}",
                        temporary_path.display()
                    )
                });
            }
        }
    }

    Ok(final_path)
}

#[cfg(target_os = "macos")]
#[cfg_attr(not(feature = "verge-dev"), allow(clippy::unnecessary_wraps))]
fn macos_service_tool_path(source: &Path) -> Result<PathBuf> {
    #[cfg(feature = "verge-dev")]
    {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        service_tool_path_for(source, home.as_deref(), true)
    }

    #[cfg(not(feature = "verge-dev"))]
    Ok(source.to_path_buf())
}

fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
    let sibling = current_exe()
        .map_err(|error| {
            anyhow::anyhow!(
                "failed to locate the current executable while resolving Service core {clash_core:?}: {error}"
            )
        })?
        .with_file_name(format!("{clash_core}{bin_ext}"));

    #[cfg(all(target_os = "macos", feature = "verge-dev"))]
    {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        service_core_path_for(&sibling, home.as_deref(), true)
    }

    #[cfg(not(all(target_os = "macos", feature = "verge-dev")))]
    Ok(sibling)
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

#[cfg(any(target_os = "macos", test))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(any(target_os = "macos", test))]
fn macos_install_shell(install_path: &Path, gid: u32) -> String {
    let install_quoted = shell_single_quote(&install_path.to_string_lossy());
    format!("cd /; CLASH_VERGE_SERVICE_GID={gid} {install_quoted}")
}

fn packaged_service_tool_path(file_name: &str, packaged_path: impl FnOnce() -> Result<PathBuf>) -> Result<PathBuf> {
    #[cfg(feature = "verge-dev")]
    {
        drop(packaged_path);
        let directory = std::env::var_os("CLASH_VERGE_DEV_SERVICE_DIR")
            .context("CLASH_VERGE_DEV_SERVICE_DIR is missing from the development session")?;
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            bail!("CLASH_VERGE_DEV_SERVICE_DIR must be an absolute path");
        }
        Ok(directory.join(file_name))
    }

    #[cfg(not(feature = "verge-dev"))]
    {
        let _ = file_name;
        packaged_path()
    }
}

#[cfg(target_os = "windows")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let uninstall_path = packaged_service_tool_path("clash-verge-service-uninstall.exe", || {
        Ok(dirs::service_path()?.with_file_name("clash-verge-service-uninstall.exe"))
    })?;

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

    let install_path = packaged_service_tool_path("clash-verge-service-install.exe", || {
        Ok(dirs::service_path()?.with_file_name("clash-verge-service-install.exe"))
    })?;

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

    let uninstall_path = packaged_service_tool_path("clash-verge-service-uninstall", || {
        Ok(tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-uninstall"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&uninstall_path).status()?
    } else {
        let result = StdCommand::new(&elevator)
            .arg("--disable-internal-agent")
            .arg(&uninstall_path)
            .status()?;

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

    let install_path = packaged_service_tool_path("clash-verge-service-install", || {
        Ok(tauri::utils::platform::current_exe()?.with_file_name("clash-verge-service-install"))
    })?;

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let output = if linux_running_as_root() {
        StdCommand::new(&install_path).output()?
    } else {
        let result = StdCommand::new(&elevator)
            .arg("--disable-internal-agent")
            .arg(&install_path)
            .output()?;

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

    let uninstall_path = packaged_service_tool_path("clash-verge-service-uninstall", || {
        Ok(dirs::service_path()?.with_file_name("clash-verge-service-uninstall"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_path = macos_service_tool_path(&uninstall_path)?;
    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    // clash_verge_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let prompt = clash_verge_i18n::t!("service.adminUninstallPrompt");
    // 先清理服务残留,再执行卸载器。
    let uninstall_quoted = shell_single_quote(&uninstall_shell);
    let shell = format!("cd /; {}; {uninstall_quoted}", macos_force_stop_core_shell());
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

    let binary_path = packaged_service_tool_path("clash-verge-service", dirs::service_path)?;
    let install_path = packaged_service_tool_path("clash-verge-service-install", || {
        Ok(dirs::service_path()?.with_file_name("clash-verge-service-install"))
    })?;

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    macos_service_tool_path(&binary_path)?;
    let install_path = macos_service_tool_path(&install_path)?;

    // clash_verge_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let gid = tauri_plugin_clash_verge_sysinfo::current_gid();
    let prompt = clash_verge_i18n::t!("service.adminInstallPrompt");
    let shell = macos_install_shell(&install_path, gid);
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
    install_service()
}

/// 强制重装服务（UI修复按钮）
fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "用户请求强制重装服务");
    install_service().map_err(|err| {
        logging!(error, Type::Service, "强制重装服务失败: {}", err);
        err
    })
}

/// Dispatches a privileged platform operation on a blocking thread.
pub(crate) fn run_privileged_service_action(action: PendingAction) -> Result<()> {
    let (operation, label): (fn() -> Result<()>, &'static str) = match action {
        PendingAction::Install => (install_service, "install service"),
        PendingAction::Uninstall => (uninstall_service, "uninstall service"),
        PendingAction::Reinstall => (reinstall_service, "reinstall service"),
        PendingAction::ForceReinstall => (force_reinstall_service, "force reinstall service"),
    };
    tokio::task::block_in_place(operation).with_context(|| format!("{label} failed"))
}

/// Builds the same runtime bundle description for both service start and staging.
async fn collect_service_runtime_bundle(config_file: &Path) -> Result<RuntimeBundle> {
    let verge_config = Config::verge().await;
    let clash_core = verge_config.latest_arc().get_valid_clash_core();
    drop(verge_config);

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let bin_path = service_core_path(&clash_core, bin_ext)?;
    collect_runtime_bundle(config_file, &bin_path).await
}

/// A staging response whose refusal code tells callers whether a fresh start can help.
pub(super) enum StageRequest {
    Refused { code: u16, message: CompactString },
    Answered(StageRuntimeOutcome),
}

impl StageRequest {
    /// Whether a refusal is about the bundle, and so would be repeated by starting from it.
    pub(super) const fn is_about_the_bundle(code: u16) -> bool {
        code == ServiceErrorCode::InvalidRuntimeAsset as u16 || code == ServiceErrorCode::InvalidInstallLocation as u16
    }
}

/// Requests in-place staging. `Err` means no answer; refusals are returned for caller policy.
pub(super) async fn stage_runtime_by_service(config_file: &Path) -> Result<StageRequest> {
    let session = active_service_session()?;
    let credentials = current_owner_credentials()?;
    let runtime = collect_service_runtime_bundle(config_file).await?;

    let response = clash_verge_service_ipc::stage_runtime(&credentials, &session, &runtime)
        .await
        .context("无法连接到Clash Verge Service")?;
    if response.code > 0 {
        return Ok(StageRequest::Refused {
            code: response.code,
            message: response.message.into(),
        });
    }
    response
        .data
        .map(StageRequest::Answered)
        .context("Clash Verge Service 未返回运行时暂存结果")
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &Path) -> Result<()> {
    logging!(info, Type::Service, "尝试使用现有服务启动核心");
    clear_active_service_session();

    let credentials = current_owner_credentials()?;
    let runtime = collect_service_runtime_bundle(config_file).await?;
    let proposed_session_token = generate_service_session_token()?;
    let request = StartClashRequest {
        runtime,
        proposed_session_token: proposed_session_token.clone(),
        macos_proxy: None,
    };

    let response = match clash_verge_service_ipc::start_clash(&credentials, &request).await {
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
        bail!(
            "failed to start Service core at {}: {err_msg}",
            request.runtime.core_path
        );
    }

    let result = response.data.context("Clash Verge Service 未返回会话信息")?;
    let supports_runtime_staging = probe_runtime_staging_support().await;
    *ACTIVE_SERVICE_SESSION.lock() = Some(ActiveServiceSession {
        proof: OwnerSessionProof {
            generation: result.session.generation,
            token: proposed_session_token,
        },
        supports_runtime_staging,
    });

    // PAC follows the Running Mode; the caller opens it via `core_started(Service)`.
    start_owner_monitor();
    logging!(info, Type::Service, "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &Path) -> Result<()> {
    logging!(info, Type::Service, "正在尝试通过服务启动核心");

    SERVICE_MANAGER.refresh().await?;

    let status = SERVICE_MANAGER.current().await;
    if !matches!(status, ServiceStatus::Ready) {
        bail!("service is not ready after refresh: {status:?}");
    }

    logging!(info, Type::Service, "服务已运行且版本匹配，直接使用");
    start_with_existing_service(config_file).await
}

async fn capture_generation_before<F, Fut, T>(generation: &AtomicU64, operation: F) -> (u64, T)
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    let captured = generation.load(Ordering::Acquire);
    (captured, operation().await)
}

pub(super) async fn get_clash_logs_by_service() -> Result<Vec<CompactString>> {
    logging!(info, Type::Service, "正在获取服务模式下的 Clash 日志");

    let credentials = current_owner_credentials()?;
    let (generation, response) = capture_generation_before(&OWNER_MONITOR_GENERATION, || {
        clash_verge_service_ipc::get_clash_logs(&credentials)
    })
    .await;
    let response = response.context("无法连接到Clash Verge Service")?;

    if response.code > 0 {
        if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
            recover_after_owner_loss(generation, OwnerRecoveryReason::Displaced).await;
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
    let (generation, response) = capture_generation_before(&OWNER_MONITOR_GENERATION, || {
        clash_verge_service_ipc::get_clash_log_snapshot(&credentials)
    })
    .await;
    let response = response.context("无法连接到Clash Verge Service")?;
    if response.code > 0 {
        if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
            recover_after_owner_loss(generation, OwnerRecoveryReason::Displaced).await;
        }
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
    cancel_owner_monitors();

    let credentials = match current_owner_credentials() {
        Ok(credentials) => credentials,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let session = match active_service_session() {
        Ok(session) => session,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let response = match clash_verge_service_ipc::stop_clash(&credentials, &session).await {
        Ok(response) => response,
        Err(error) => {
            start_owner_monitor();
            return Err(error).context("无法连接到Clash Verge Service");
        }
    };

    if response.code > 0 {
        if matches!(
            response.code,
            code if code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16
                || code == clash_verge_service_ipc::ServiceErrorCode::StaleOwnerSession as u16
        ) {
            recover_after_owner_loss_while_locked(OwnerRecoveryReason::Displaced).await;
        } else {
            start_owner_monitor();
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    clear_active_service_session();
    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

pub(crate) async fn update_writer_by_service(writer: &WriterConfig) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let session = active_service_session()?;
    let response = clash_verge_service_ipc::update_writer(&credentials, &session, writer)
        .await
        .context("无法连接到Clash Verge Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

pub(super) async fn set_system_proxy_by_service(proxy: &MacosProxyConfig) -> Result<ProxyApplyOutcome> {
    let session = active_service_session()?;
    set_system_proxy_by_service_with_session(proxy, &session).await
}

pub(super) async fn set_system_proxy_by_service_with_session(
    proxy: &MacosProxyConfig,
    session: &OwnerSessionProof,
) -> Result<ProxyApplyOutcome> {
    let credentials = current_owner_credentials()?;
    let response = clash_verge_service_ipc::set_system_proxy(&credentials, session, proxy)
        .await
        .context("无法连接到Clash Verge Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Clash Verge Service 未返回系统代理结果")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OwnerRecoveryPolicy {
    reset_system_proxy: bool,
}

const fn owner_recovery_policy(_reason: OwnerRecoveryReason, is_macos: bool) -> OwnerRecoveryPolicy {
    OwnerRecoveryPolicy {
        reset_system_proxy: !is_macos,
    }
}

fn mark_service_unavailable_after_owner_loss<E: RunStateEnv>(store: &RunStateStore<E>, reason: OwnerRecoveryReason) {
    if matches!(reason, OwnerRecoveryReason::TransportFailure) {
        store.observe(ServiceHealth::Unavailable(
            "service control IPC unavailable after sustained transport failure".to_owned(),
        ));
    }
}

/// How often the owner monitor samples Service status.
const OWNER_MONITOR_INTERVAL: Duration = Duration::from_secs(5);
/// Mirrors `OwnerWatch`'s tolerance, for the log line only.
const SUSTAINED_OWNER_SAMPLES: u8 = 3;

fn start_owner_monitor() {
    let generation = OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    AsyncHandler::spawn(move || async move {
        let mut watch = OwnerWatch::new();
        loop {
            tokio::time::sleep(OWNER_MONITOR_INTERVAL).await;
            if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            if !matches!(*CoreManager::global().get_running_mode(), RunningMode::Service) {
                break;
            }

            let sample = read_owner_sample().await;
            let mut step = watch.observe(sample);
            if matches!(step, OwnerStep::VerifyTransport) {
                if watch.just_became_sustained() {
                    logging!(
                        warn,
                        Type::Service,
                        "service owner status unavailable for {SUSTAINED_OWNER_SAMPLES} samples; \
                         preserving local proxy state while the core endpoint still answers"
                    );
                }
                let owner_endpoint_available = Handle::mihomo().get_version().await.is_ok();
                step = watch.resolve_transport(owner_endpoint_available);
            }

            if let OwnerStep::Recover(reason) = step {
                recover_after_owner_loss(generation, reason).await;
                break;
            }
        }
    });
}

/// Samples ownership, treating every unusable reply as unreadable.
async fn read_owner_sample() -> OwnerSample {
    let response = match current_owner_credentials() {
        Ok(credentials) => clash_verge_service_ipc::get_status(&credentials).await,
        Err(error) => Err(error),
    };

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            logging!(debug, Type::Service, "service owner status was unreadable: {error:#}");
            return OwnerSample::Unreadable;
        }
    };

    if response.code == clash_verge_service_ipc::ServiceErrorCode::NotActive as u16 {
        return OwnerSample::NotActive;
    }
    if response.code != 0 {
        logging!(
            debug,
            Type::Service,
            "service owner status returned error {}: {}",
            response.code,
            response.message
        );
        return OwnerSample::Unreadable;
    }
    let Some(status) = response.data else {
        logging!(debug, Type::Service, "service owner status omitted data");
        return OwnerSample::Unreadable;
    };

    // A session that no longer matches is another owner's, whatever the flags say.
    if !session_matches_active_status(status.is_active, status.active_generation) {
        return OwnerSample::NotActive;
    }

    OwnerSample::Status {
        is_active: status.is_active,
        desired_core_should_be_running: status.desired_core_should_be_running,
        service_state: status.service_state,
        core_pid: status.core_pid,
    }
}

fn session_matches_active_status(is_active: bool, active_generation: Option<u64>) -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session_matches_status(&session.proof, is_active, active_generation))
}

fn cancel_owner_monitors() {
    OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel);
}

pub(crate) fn owner_monitor_generation() -> u64 {
    OWNER_MONITOR_GENERATION.load(Ordering::Acquire)
}

async fn recover_after_owner_loss(generation: u64, reason: OwnerRecoveryReason) {
    let manager = CoreManager::global();
    if !matches!(*manager.get_running_mode(), RunningMode::Service) {
        return;
    }
    let Some(recovery_generation) = claim_owner_recovery_generation(&OWNER_MONITOR_GENERATION, generation) else {
        return;
    };
    manager.invalidate_core_readiness();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != recovery_generation
        || !matches!(*manager.get_running_mode(), RunningMode::Service)
    {
        return;
    }
    recover_after_owner_loss_while_locked(reason).await;
}

fn claim_owner_recovery_generation(generation: &AtomicU64, captured_generation: u64) -> Option<u64> {
    let recovery_generation = captured_generation.wrapping_add(1);
    generation
        .compare_exchange(
            captured_generation,
            recovery_generation,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .ok()
        .map(|_| recovery_generation)
}

async fn recover_after_owner_loss_while_locked(reason: OwnerRecoveryReason) {
    logging!(
        warn,
        Type::Service,
        "service owner recovery ({reason:?}); clearing local proxy and PAC state"
    );
    mark_service_unavailable_after_owner_loss(&RUN_STATE, reason);
    proxy_control::stop_guard().await;
    clear_active_service_session();
    CoreManager::global().core_stopped();

    if !owner_recovery_policy(reason, cfg!(target_os = "macos")).reset_system_proxy {
        return;
    }

    let mut last_error = None;
    for _ in 0..3 {
        match proxy_control::clear().await {
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

/// Waits for a repaired service, preserving readable rejection details but classifying sustained
/// silence as unavailable.
async fn wait_for_service_ipc() -> Result<()> {
    const CONTEXT: &str = "service IPC did not become available";
    let config = ServiceManager::config();

    match RUN_STATE.await_ready(config.max_retries, config.retry_delay).await {
        Ok(_) => Ok(()),
        Err(ReadyWaitError::Unreachable(error)) => {
            RUN_STATE.observe(ServiceHealth::Unavailable(format!("{CONTEXT}: {error:#}")));
            Err(error).context(CONTEXT)
        }
        Err(ReadyWaitError::Rejected(error)) => Err(error).context(CONTEXT),
    }
}

impl ServiceManager {
    pub const fn config() -> clash_verge_service_ipc::IpcConfig {
        clash_verge_service_ipc::IpcConfig {
            default_timeout: Duration::from_millis(1000),
            retry_delay: Duration::from_millis(500),
            max_retries: 20,
        }
    }

    pub async fn confirm_ready(&self) -> Result<()> {
        RUN_STATE.probe().await.map(|_| ())
    }

    pub async fn current(&self) -> ServiceStatus {
        ServiceStatus::from_run_state(&RUN_STATE.settled().await)
    }

    pub fn allow_sidecar_for_session(&self) -> Result<()> {
        RUN_STATE.allow_sidecar_for_session()
    }

    pub fn require_install_for_session(&self) -> Result<()> {
        RUN_STATE.require_install_for_session()
    }

    pub(crate) fn withdraw_sidecar_allowance(&self) -> bool {
        RUN_STATE.withdraw_sidecar_allowance()
    }

    pub async fn detect_startup_status(&self) {
        if cfg!(feature = "dev-sidecar") {
            RUN_STATE.accept_sidecar();
            return;
        }
        RUN_STATE.observe_current_health().await;
    }

    fn set_status(&self, status: ServiceStatus) {
        record_status(&RUN_STATE, status);
    }

    async fn run_operation(&self, operation: impl Future<Output = Result<()>>) -> Result<()> {
        run_operation_and_then(&RUN_STATE, operation, || async {
            if let Err(error) = Tray::global().update_menu().await {
                logging!(
                    warn,
                    Type::Service,
                    "failed to refresh tray after service operation: {error:#}"
                );
            }
            Ok(())
        })
        .await
    }

    pub async fn refresh(&self) -> Result<()> {
        self.run_operation(async { self.confirm_ready().await }).await
    }

    pub async fn handle_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Box the large operation future once instead of carrying it in every calling command.
        self.run_operation(Box::pin(self.apply_service_status(status))).await
    }

    async fn apply_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Use the caller's action; a racing observation may clear the stored pending action.
        let Some(action) = requested_action(&status) else {
            self.set_status(status.clone());
            return report_non_actionable_status(status);
        };
        // Atomically record the request and capture the Sidecar allowance it clears.
        let sidecar_allowed_before = RUN_STATE.request_action(action);

        logging!(info, Type::Service, "running privileged service action {action:?}");
        run_action_restoring_sidecar(&RUN_STATE, sidecar_allowed_before, async move {
            RUN_STATE.perform(action).await?;
            if !matches!(action, PendingAction::Uninstall) {
                wait_for_service_ipc().await?;
                Config::restore_tun_for_session().await;
            }
            Ok(())
        })
        .await
    }
}

/// Runs through readiness and restores a displaced Sidecar allowance on failure.
async fn run_action_restoring_sidecar<E: RunStateEnv>(
    store: &RunStateStore<E>,
    was_allowed: bool,
    action: impl Future<Output = Result<()>>,
) -> Result<()> {
    let outcome = action.await;
    if outcome.is_err() && was_allowed && store.restore_sidecar_allowance() {
        logging!(
            info,
            Type::Service,
            "restored the Sidecar this session had already settled on"
        );
    }
    outcome
}

/// Explain a status that asks for no privileged action, refusing the ones we cannot act on.
fn report_non_actionable_status(status: ServiceStatus) -> Result<()> {
    match status {
        ServiceStatus::Checking => bail!("service status is still being checked"),
        ServiceStatus::Ready => logging!(info, Type::Service, "服务就绪，直接启动"),
        ServiceStatus::NotInstalled => {
            logging!(info, Type::Service, "service is not installed; Sidecar is available");
        }
        ServiceStatus::NeedsReinstall => {
            bail!("service needs reinstall; explicit authorization is required");
        }
        ServiceStatus::Unavailable(reason) => {
            logging!(info, Type::Service, "服务不可用: {}，将使用Sidecar模式", reason);
            bail!("服务不可用: {}", reason);
        }
        ServiceStatus::SidecarAllowed => {
            logging!(
                info,
                Type::Service,
                "Sidecar was explicitly allowed for this app session"
            );
        }
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            bail!("a requested action should have been handled as a privileged operation")
        }
    }
    Ok(())
}

/// Releases the Run State operation slot before post-operation observers refresh.
async fn run_operation_and_then<E, Post, PostFuture>(
    store: &RunStateStore<E>,
    operation: impl Future<Output = Result<()>>,
    post_operation: Post,
) -> Result<()>
where
    E: RunStateEnv,
    Post: FnOnce() -> PostFuture,
    PostFuture: Future<Output = Result<()>>,
{
    let result = {
        let _operation = store.begin_operation()?;
        operation.await
    };
    result?;
    post_operation().await
}

/// Maps a legacy status to its requested action without racing a store reread.
const fn requested_action(status: &ServiceStatus) -> Option<PendingAction> {
    match status {
        ServiceStatus::InstallRequired => Some(PendingAction::Install),
        ServiceStatus::UninstallRequired => Some(PendingAction::Uninstall),
        ServiceStatus::ReinstallRequired => Some(PendingAction::Reinstall),
        ServiceStatus::ForceReinstallRequired => Some(PendingAction::ForceReinstall),
        ServiceStatus::Checking
        | ServiceStatus::Ready
        | ServiceStatus::NotInstalled
        | ServiceStatus::NeedsReinstall
        | ServiceStatus::SidecarAllowed
        | ServiceStatus::Unavailable(_) => None,
    }
}

fn record_status<E: RunStateEnv>(store: &RunStateStore<E>, status: ServiceStatus) {
    if let Some(action) = requested_action(&status) {
        store.request_action(action);
        return;
    }

    match status {
        ServiceStatus::SidecarAllowed => store.accept_sidecar(),
        ServiceStatus::Checking => store.observe(ServiceHealth::Unknown),
        ServiceStatus::Ready => store.observe(ServiceHealth::Ready),
        ServiceStatus::NotInstalled => store.observe(ServiceHealth::NotInstalled),
        ServiceStatus::NeedsReinstall => store.observe(ServiceHealth::VersionMismatch),
        ServiceStatus::Unavailable(reason) => store.observe(ServiceHealth::Unavailable(reason)),
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            // Recorded by the early return above; listed so a new variant still fails to
            // compile here rather than falling through a catch-all.
        }
    }
}

pub static SERVICE_MANAGER: ServiceManager = ServiceManager;

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::{
        ServiceHealth, ServiceStatus, capture_generation_before, claim_owner_recovery_generation,
        generate_service_session_token, macos_install_shell, mark_service_unavailable_after_owner_loss,
        owner_recovery_policy, service_core_path_for, session_matches_status,
    };
    #[cfg(unix)]
    use super::{service_core_path_for_with_publisher, service_tool_path_for};
    use crate::core::runstate::{FakeEnv, OwnerRecoveryReason, PendingAction, RunStateStore};
    use anyhow::bail;
    use clash_verge_service_ipc::OwnerSessionProof;
    #[cfg(unix)]
    use std::cell::Cell;
    use std::{
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    /// A Run State backed by a scripted environment, so these tests never touch the global.
    fn fake_store() -> RunStateStore<FakeEnv> {
        RunStateStore::new(FakeEnv::new())
    }

    /// The legacy single-slot view of a store, for assertions carried over from before the split.
    fn status_of(store: &RunStateStore<FakeEnv>) -> ServiceStatus {
        ServiceStatus::from_run_state(&store.state())
    }

    async fn status_of_settled(store: &RunStateStore<FakeEnv>) -> ServiceStatus {
        ServiceStatus::from_run_state(&store.settled().await)
    }

    static TEST_DIRECTORY_GENERATION: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> anyhow::Result<Self> {
            let generation = TEST_DIRECTORY_GENERATION.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "clash-verge-rev-service-{label}-{}-{generation}",
                std::process::id()
            ));
            std::fs::create_dir(&path)?;
            Ok(Self(path))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn staging_directory(home: &Path) -> PathBuf {
        home.join("Applications/.clash-verge-rev-dev/service-core")
    }

    #[cfg(unix)]
    fn service_tools_staging_directory(home: &Path) -> PathBuf {
        home.join("Applications/.clash-verge-rev-dev/service-tools")
    }

    #[cfg(unix)]
    fn staging_temporary_entries(home: &Path, core_name: &str) -> anyhow::Result<Vec<PathBuf>> {
        let directory = staging_directory(home);
        if !directory.exists() {
            return Ok(Vec::new());
        }
        Ok(std::fs::read_dir(directory)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&format!(".{core_name}.")) && name.ends_with(".tmp"))
            })
            .collect())
    }

    #[test]
    fn nondevelopment_service_core_selection_preserves_sibling_without_staging() -> anyhow::Result<()> {
        let root = TestDirectory::new("release-path")?;
        let home = root.path().join("home");
        let source = root.path().join("target/debug/verge-mihomo");

        let selected = service_core_path_for(&source, Some(&home), false)?;

        assert_eq!(selected, source);
        assert!(!staging_directory(&home).exists());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_uses_exact_layout_and_executable_bytes() -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        let root = TestDirectory::new("development-path")?;
        let home = root.path().join("home");
        let source = root.path().join("verge-mihomo");
        std::fs::write(&source, b"development core")?;

        let selected = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(
            selected,
            home.join("Applications/.clash-verge-rev-dev/service-core/verge-mihomo")
        );
        assert_eq!(std::fs::read(&selected)?, b"development core");
        let metadata = std::fs::symlink_metadata(&selected)?;
        assert!(metadata.file_type().is_file());
        assert_ne!(metadata.permissions().mode() & 0o111, 0);
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_tool_uses_safe_layout_and_executable_bytes() -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        let root = TestDirectory::new("development-service-tool")?;
        let home = root.path().join("home");
        let source = root.path().join("clash-verge-service-install");
        std::fs::write(&source, b"development installer")?;

        let selected = service_tool_path_for(&source, Some(&home), true)?;

        assert_eq!(
            selected,
            service_tools_staging_directory(&home).join("clash-verge-service-install")
        );
        assert_eq!(std::fs::read(&selected)?, b"development installer");
        assert_ne!(std::fs::metadata(&selected)?.permissions().mode() & 0o111, 0);
        Ok(())
    }

    #[test]
    fn macos_install_shell_starts_from_root_without_nested_sudo() {
        let shell = macos_install_shell(Path::new("/safe/service-tools/clash-verge-service-install"), 20);

        assert_eq!(
            shell,
            "cd /; CLASH_VERGE_SERVICE_GID=20 '/safe/service-tools/clash-verge-service-install'"
        );
        assert!(!shell.contains("sudo"));
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_refresh_atomically_replaces_bytes() -> anyhow::Result<()> {
        let root = TestDirectory::new("refresh")?;
        let home = root.path().join("home");
        let source = root.path().join("verge-mihomo");
        std::fs::write(&source, b"first core")?;
        let selected = service_core_path_for(&source, Some(&home), true)?;
        assert_eq!(
            selected,
            home.join("Applications/.clash-verge-rev-dev/service-core/verge-mihomo")
        );

        std::fs::write(&source, b"second core")?;
        let refreshed = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(refreshed, selected);
        assert_eq!(std::fs::read(&refreshed)?, b"second core");
        assert!(staging_temporary_entries(&home, "verge-mihomo")?.is_empty());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn failed_development_refresh_preserves_good_core_and_cleans_temporary_entry() -> anyhow::Result<()> {
        let root = TestDirectory::new("failed-refresh")?;
        let home = root.path().join("home");
        let source = root.path().join("verge-mihomo");
        std::fs::write(&source, b"known good core")?;
        let selected = service_core_path_for(&source, Some(&home), true)?;

        std::fs::write(&source, b"replacement core")?;
        let publish_attempted = Cell::new(false);
        let result = service_core_path_for_with_publisher(
            &source,
            Some(&home),
            true,
            "service-core",
            |temporary, final_path| {
                publish_attempted.set(true);
                assert_ne!(temporary, final_path, "publisher must receive the temporary path");
                assert!(std::fs::symlink_metadata(temporary)?.file_type().is_file());
                assert_eq!(std::fs::read(temporary)?, b"replacement core");
                anyhow::bail!("injected post-creation publish failure")
            },
        );
        let error = match result {
            Ok(path) => anyhow::bail!("failed publication selected {}", path.display()),
            Err(error) => error.to_string(),
        };

        assert!(publish_attempted.get());
        assert!(error.contains("injected post-creation publish failure"));
        assert_eq!(std::fs::read(&selected)?, b"known good core");
        assert!(staging_temporary_entries(&home, "verge-mihomo")?.is_empty());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_replaces_final_symlink_without_following_it() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let root = TestDirectory::new("symlink")?;
        let home = root.path().join("home");
        let source = root.path().join("verge-mihomo");
        std::fs::write(&source, b"selected core")?;
        let final_path = home.join("Applications/.clash-verge-rev-dev/service-core/verge-mihomo");
        std::fs::create_dir_all(final_path.parent().unwrap_or_else(|| Path::new(".")))?;
        let symlink_target = root.path().join("must-not-change");
        std::fs::write(&symlink_target, b"target bytes")?;
        symlink(&symlink_target, &final_path)?;

        let selected = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(selected, final_path);
        assert!(std::fs::symlink_metadata(&selected)?.file_type().is_file());
        assert_eq!(std::fs::read(&selected)?, b"selected core");
        assert_eq!(std::fs::read(&symlink_target)?, b"target bytes");
        Ok(())
    }

    #[test]
    fn mismatched_active_generation_displaces_local_session() {
        let proof = OwnerSessionProof {
            generation: 7,
            token: "11".repeat(32),
        };
        assert!(session_matches_status(&proof, true, Some(7)));
        assert!(!session_matches_status(&proof, true, Some(8)));
        assert!(!session_matches_status(&proof, false, Some(7)));
    }

    #[test]
    fn a_stale_monitor_cannot_displace_a_newer_session() {
        // Sample classification now lives in `core::runstate::owner`; what stays here is the
        // guard that stops a monitor from a previous Core from tearing down the current one.
        let generation = AtomicU64::new(8);
        let newer_proof = OwnerSessionProof {
            generation: 8,
            token: "22".repeat(32),
        };
        let session = parking_lot::Mutex::new(Some(newer_proof.clone()));

        // A monitor started at generation 7 decides it has been displaced and tries to recover.
        if claim_owner_recovery_generation(&generation, 7).is_some() {
            session.lock().take();
        }

        assert_eq!(generation.load(Ordering::Acquire), 8, "the newer generation stands");
        assert_eq!(session.lock().as_ref(), Some(&newer_proof));
    }

    #[test]
    fn generated_service_session_token_is_lower_hex() -> anyhow::Result<()> {
        let token = generate_service_session_token()?;
        assert_eq!(token.len(), 64);
        assert!(
            token
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        );
        Ok(())
    }

    #[test]
    fn macos_recovery_never_resets_machine_wide_proxy() {
        for reason in [
            OwnerRecoveryReason::Displaced,
            OwnerRecoveryReason::SameOwnerFailure,
            OwnerRecoveryReason::TransportFailure,
        ] {
            assert!(!owner_recovery_policy(reason, true).reset_system_proxy);
            assert!(owner_recovery_policy(reason, false).reset_system_proxy);
        }

        let generation = AtomicU64::new(7);
        assert_eq!(claim_owner_recovery_generation(&generation, 7), Some(8));
        assert_eq!(generation.load(Ordering::Acquire), 8);
        assert_eq!(claim_owner_recovery_generation(&generation, 7), None);
    }

    #[test]
    fn cached_readiness_reflects_confirmed_state_without_mutating_it() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);
        let generation = store.generation_count();

        assert!(store.state().service_usable());
        assert_eq!(status_of(&store), ServiceStatus::Ready);
        assert_eq!(store.generation_count(), generation, "reading must not change state");

        store.observe(ServiceHealth::NotInstalled);
        assert!(!store.state().service_usable());
        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert_eq!(store.generation_count(), generation + 1);
    }

    #[test]
    fn cached_readiness_is_false_while_a_service_operation_is_running() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);
        let _operation = store.begin_operation().expect("slot should be free");

        assert!(!store.state().service_usable());
        // The confirmed observation survives — only usability is withheld.
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }

    #[tokio::test]
    async fn service_operation_finishes_before_post_operation_refresh() {
        let store = fake_store();

        let result = super::run_operation_and_then(
            &store,
            async {
                store.observe(ServiceHealth::Ready);
                Ok(())
            },
            || async {
                assert!(!store.operation_in_flight());
                assert_eq!(status_of_settled(&store).await, ServiceStatus::Ready);
                Ok(())
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn owner_generation_is_captured_before_async_request_runs() {
        let generation = AtomicU64::new(7);
        let (captured, response) = capture_generation_before(&generation, || async {
            generation.store(8, Ordering::Release);
            "not-active"
        })
        .await;

        assert_eq!(captured, 7);
        assert_eq!(response, "not-active");
        assert_eq!(generation.load(Ordering::Acquire), 8);
    }

    #[test]
    fn only_transport_owner_loss_marks_cached_readiness_unavailable() {
        for reason in [OwnerRecoveryReason::Displaced, OwnerRecoveryReason::SameOwnerFailure] {
            let store = fake_store();
            store.observe(ServiceHealth::Ready);
            let generation = store.generation_count();

            mark_service_unavailable_after_owner_loss(&store, reason);

            assert!(store.state().service_usable(), "{reason:?} must not affect readiness");
            assert_eq!(status_of(&store), ServiceStatus::Ready);
            assert_eq!(store.generation_count(), generation);
        }

        let store = fake_store();
        store.observe(ServiceHealth::Ready);

        mark_service_unavailable_after_owner_loss(&store, OwnerRecoveryReason::TransportFailure);

        assert!(!store.state().service_usable());
        assert!(matches!(
            status_of(&store),
            ServiceStatus::Unavailable(reason) if reason.contains("service control IPC unavailable")
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_socket_alone_is_not_install_evidence() {
        assert!(
            !super::macos_service_install_markers()
                .iter()
                .any(|marker| marker == "/tmp/verge/clash-verge-service.sock")
        );
    }

    #[test]
    fn failed_install_status_can_be_replaced_with_sidecar_allowance() {
        let store = fake_store();
        store.request_action(super::PendingAction::Install);
        assert_eq!(status_of(&store), ServiceStatus::InstallRequired);
        let generation = store.generation_count();

        assert!(store.allow_sidecar_for_session().is_ok());

        assert_eq!(status_of(&store), ServiceStatus::SidecarAllowed);
        assert_eq!(store.generation_count(), generation + 1);
    }

    #[test]
    fn only_explicit_action_states_ask_for_a_privileged_operation() {
        for status in [
            ServiceStatus::Checking,
            ServiceStatus::Ready,
            ServiceStatus::NotInstalled,
            ServiceStatus::NeedsReinstall,
            ServiceStatus::SidecarAllowed,
            ServiceStatus::Unavailable("offline".into()),
        ] {
            let store = fake_store();
            super::record_status(&store, status.clone());
            assert_eq!(
                store.state().pending,
                None,
                "{status:?} is an observation, not a request"
            );
        }

        for (status, expected) in [
            (ServiceStatus::InstallRequired, PendingAction::Install),
            (ServiceStatus::UninstallRequired, PendingAction::Uninstall),
            (ServiceStatus::ReinstallRequired, PendingAction::Reinstall),
            (ServiceStatus::ForceReinstallRequired, PendingAction::ForceReinstall),
        ] {
            let store = fake_store();
            super::record_status(&store, status.clone());
            assert_eq!(store.state().pending, Some(expected), "{status:?}");
        }
    }

    #[tokio::test]
    async fn a_failed_uninstall_asks_the_machine_rather_than_condemning_the_service() {
        // A cancelled uninstall may leave the Service healthy; use the fresh probe result.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_ready()
                .privileged_operations_fail("no authorization"),
        );
        store.observe(ServiceHealth::Ready);

        let error = store
            .perform(PendingAction::Uninstall)
            .await
            .expect_err("an unauthorized uninstall should fail");

        assert!(error.to_string().contains("no authorization"));
        assert_eq!(status_of(&store), ServiceStatus::Ready);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn a_failed_uninstall_still_reports_a_service_the_uninstaller_broke() {
        // A failed uninstaller can still leave the Service registered but unreachable.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_unreachable()
                .privileged_operations_fail("uninstaller exited with 1"),
        );
        store.observe(ServiceHealth::Ready);

        store
            .perform(PendingAction::Uninstall)
            .await
            .expect_err("a broken uninstall should fail");

        assert!(matches!(status_of(&store), ServiceStatus::Unavailable(_)));
        assert!(store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn a_successful_uninstall_records_an_absent_service() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);

        store
            .perform(PendingAction::Uninstall)
            .await
            .expect("uninstall should succeed");

        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert_eq!(store.env().privileged_actions(), vec![PendingAction::Uninstall]);
    }

    #[tokio::test]
    async fn a_cancelled_install_leaves_no_question_for_the_user() {
        // A cancelled action must retire its request or the attention dialog reopens.
        let store = RunStateStore::new(FakeEnv::new().privileged_operations_fail("User canceled. (-128)"));
        store.observe(ServiceHealth::NotInstalled);
        super::record_status(&store, ServiceStatus::InstallRequired);

        store
            .perform(PendingAction::Install)
            .await
            .expect_err("a cancelled install should fail");

        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert!(
            !store.state().service_needs_attention(),
            "a service that is merely absent asks the user nothing"
        );
    }

    #[tokio::test]
    async fn a_failed_install_still_reports_a_service_that_really_is_broken() {
        // A fresh probe must preserve a real fault left by a failed installer.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_unreachable()
                .privileged_operations_fail("installer exited with 1"),
        );
        super::record_status(&store, ServiceStatus::ForceReinstallRequired);

        store
            .perform(PendingAction::ForceReinstall)
            .await
            .expect_err("a broken repair should fail");

        assert!(matches!(status_of(&store), ServiceStatus::Unavailable(_)));
        assert!(store.state().service_needs_attention());
    }

    /// Build a session where the user already accepted Sidecar for an unhealthy Service.
    fn store_settled_on_sidecar(env: FakeEnv) -> RunStateStore<FakeEnv> {
        let store = RunStateStore::new(env);
        store.observe(ServiceHealth::VersionMismatch);
        store.accept_sidecar();
        assert!(!store.state().service_needs_attention(), "the question was answered");
        store
    }

    #[tokio::test]
    async fn a_cancelled_action_gives_back_the_sidecar_the_session_had_settled_on() {
        // A failed action must restore the Sidecar decision displaced by its request.
        let store = store_settled_on_sidecar(
            FakeEnv::new()
                .service_version_mismatch()
                .privileged_operations_fail("User canceled. (-128)"),
        );
        // Recording the request returns the allowance it displaced.
        let was_allowed = store.request_action(PendingAction::Install);
        assert!(was_allowed, "the request displaced the session's answer");
        assert!(!store.state().sidecar_allowed);

        let outcome = super::run_action_restoring_sidecar(&store, was_allowed, async {
            store.perform(PendingAction::Install).await
        })
        .await;

        assert!(outcome.is_err(), "the failure is still reported to the caller");
        assert!(store.state().sidecar_allowed);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn an_authorised_action_that_never_became_ready_also_gives_the_sidecar_back() {
        // Roll back the full workflow, including readiness failures after the action succeeds.
        let store = store_settled_on_sidecar(FakeEnv::new().service_version_mismatch());
        let was_allowed = store.request_action(PendingAction::Install);

        let outcome = super::run_action_restoring_sidecar(&store, was_allowed, async {
            store.perform(PendingAction::Install).await?;
            // Simulate `wait_for_service_ipc` recording health before it fails.
            store.observe(ServiceHealth::Unavailable("service never answered".to_owned()));
            bail!("service IPC did not become available")
        })
        .await;

        assert!(outcome.is_err());
        assert!(store.state().sidecar_allowed);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn an_action_that_lands_keeps_the_session_on_the_service() {
        let store = RunStateStore::new(FakeEnv::new().service_ready());
        store.observe(ServiceHealth::NotInstalled);
        store.request_action(PendingAction::Install);

        super::run_action_restoring_sidecar(&store, true, async {
            store.perform(PendingAction::Install).await?;
            store.observe(ServiceHealth::Ready);
            Ok(())
        })
        .await
        .expect("the install landed");

        assert!(
            !store.state().sidecar_allowed,
            "no fallback is owed to a working Service"
        );
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }

    #[tokio::test]
    async fn a_session_that_never_chose_sidecar_is_not_given_one() {
        let store = RunStateStore::new(FakeEnv::new().service_version_mismatch());
        store.observe(ServiceHealth::VersionMismatch);

        super::run_action_restoring_sidecar(&store, false, async { bail!("refused") })
            .await
            .expect_err("the failure is reported");

        assert!(!store.state().sidecar_allowed);
        assert!(store.state().service_needs_attention());
    }

    #[test]
    fn a_service_that_came_back_ready_is_never_shadowed_by_a_restored_sidecar() {
        // The atomic ready check prevents Sidecar from shadowing a ready Service.
        let store = RunStateStore::new(FakeEnv::new().service_ready());
        store.observe(ServiceHealth::Ready);

        assert!(!store.restore_sidecar_allowance());
        assert!(!store.state().sidecar_allowed);
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }
}

use crate::{
    config::Config,
    core::service_ipc::{send_ipc_request, IpcCommand},
    logging,
    utils::{
        dirs,
        logging::{self, Type},
    },
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    env::current_exe,
    path::PathBuf,
    process::Command as StdCommand,
    time::{SystemTime, UNIX_EPOCH},
};

const REQUIRED_SERVICE_VERSION: &str = "1.1.2"; // 定义所需的服务版本号

// 限制重装时间和次数的常量
const REINSTALL_COOLDOWN_SECS: u64 = 300; // 5分钟冷却期
const MAX_REINSTALLS_PER_DAY: u32 = 3; // 每24小时最多重装3次
const ONE_DAY_SECS: u64 = 86400; // 24小时的秒数

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ServiceRecord {
    pub last_install_time: u64,     // 上次安装时间戳 (Unix 时间戳，秒)
    pub install_count: u32,         // 24小时内安装次数
    pub last_check_time: u64,       // 上次检查时间
    pub last_error: Option<String>, // 上次错误信息
    pub prefer_sidecar: bool,       // 用户是否偏好sidecar模式，如拒绝安装服务或安装失败
}

#[derive(Debug)]
pub enum ServiceStatus {
    Ready,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    Unavailable(String),
}

// 保留核心数据结构，但将HTTP特定的结构体合并为通用结构体
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

// 保留通用的响应结构体，用于IPC通信后的数据解析
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
}

impl ServiceRecord {
    // 获取当前的服务状态
    pub async fn get() -> Self {
        if let Some(state) = Config::verge().await.latest_ref().service_state.clone() {
            return state;
        }
        Self::default()
    }

    // 保存服务状态
    pub async fn save(&self) -> Result<()> {
        let config = Config::verge().await;
        let mut latest = config.latest_ref().clone();
        latest.service_state = Some(self.clone());
        *config.draft_mut() = latest;
        config.apply();

        // 先获取数据，再异步保存，避免跨await持有锁
        let verge_data = config.latest_ref().clone();
        drop(config); // 显式释放锁

        verge_data.save_file().await
    }

    // 更新安装信息
    pub fn record_install(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 检查是否需要重置计数器（24小时已过）
        if now - self.last_install_time > ONE_DAY_SECS {
            self.install_count = 0;
        }

        self.last_install_time = now;
        self.install_count += 1;
    }

    // 检查是否可以重新安装
    pub fn can_reinstall(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 如果在冷却期内，不允许重装
        if now - self.last_install_time < REINSTALL_COOLDOWN_SECS {
            return false;
        }

        // 如果24小时内安装次数过多，也不允许
        if now - self.last_install_time < ONE_DAY_SECS
            && self.install_count >= MAX_REINSTALLS_PER_DAY
        {
            return false;
        }

        true
    }
}

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

    // 获取当前服务状态
    let mut service_state = ServiceRecord::get().await;

    // 检查是否允许重装
    if !service_state.can_reinstall() {
        logging!(
            warn,
            Type::Service,
            true,
            "service reinstall rejected: cooldown period or max attempts reached"
        );
        bail!("Service reinstallation is rate limited. Please try again later.");
    }

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
        Ok(_) => {
            // 记录安装信息并保存
            service_state.record_install();
            service_state.last_error = None;
            service_state.save().await?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {err}");
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save().await?;
            bail!(error)
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

    // 获取当前服务状态
    let mut service_state = ServiceRecord::get().await;

    // 检查是否允许重装
    if !service_state.can_reinstall() {
        logging!(
            warn,
            Type::Service,
            true,
            "service reinstall rejected: cooldown period or max attempts reached"
        );
        bail!("Service reinstallation is rate limited. Please try again later.");
    }

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
        Ok(_) => {
            // 记录安装信息并保存
            service_state.record_install();
            service_state.last_error = None;
            service_state.save().await?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {err}");
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save().await?;
            bail!(error)
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

    // 获取当前服务状态
    let mut service_state = ServiceRecord::get().await;

    // 检查是否允许重装
    if !service_state.can_reinstall() {
        logging!(
            warn,
            Type::Service,
            true,
            "service reinstall rejected: cooldown period or max attempts reached"
        );
        bail!("Service reinstallation is rate limited. Please try again later.");
    }

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
        Ok(_) => {
            // 记录安装信息并保存
            service_state.record_install();
            service_state.last_error = None;
            service_state.save().await?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {err}");
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save().await?;
            bail!(error)
        }
    }
}

/// 检查服务状态 - 使用IPC通信
pub async fn check_ipc_service_status() -> Result<JsonResponse> {
    logging!(info, Type::Service, true, "开始检查服务状态 (IPC)");

    let payload = serde_json::json!({});
    let response = send_ipc_request(IpcCommand::GetClash, payload).await?;

    if !response.success {
        let err_msg = response.error.unwrap_or_else(|| "未知服务错误".to_string());
        logging!(error, Type::Service, true, "服务响应错误: {}", err_msg);
        bail!(err_msg);
    }

    let data = response
        .data
        .ok_or_else(|| anyhow::anyhow!("服务响应中没有数据"))?;

    if let (Some(code), Some(msg)) = (data.get("code"), data.get("msg")) {
        let code_value = code.as_u64().unwrap_or(0);
        let msg_value = msg.as_str().unwrap_or("ok").to_string();

        let response_body = data.get("data").and_then(|nested_data| {
            serde_json::from_value::<ResponseBody>(nested_data.clone()).ok()
        });

        return Ok(JsonResponse {
            code: code_value,
            msg: msg_value,
            data: response_body,
        });
    }

    serde_json::from_value::<JsonResponse>(data)
        .map_err(|e| anyhow::anyhow!("无法解析服务响应数据: {}", e))
}

/// 检查服务版本 - 使用IPC通信
pub async fn check_service_version() -> Result<String> {
    logging!(info, Type::Service, true, "开始检查服务版本 (IPC)");

    let payload = serde_json::json!({});
    let response = send_ipc_request(IpcCommand::GetVersion, payload).await?;

    if !response.success {
        let err_msg = response
            .error
            .unwrap_or_else(|| "获取服务版本失败".to_string());
        logging!(error, Type::Service, true, "获取版本错误: {}", err_msg);
        bail!(err_msg);
    }

    let data = response
        .data
        .ok_or_else(|| anyhow::anyhow!("服务版本响应中没有数据"))?;

    if let Some(nested_data) = data.get("data") {
        if let Some(version) = nested_data.get("version").and_then(|v| v.as_str()) {
            logging!(info, Type::Service, true, "获取到服务版本: {}", version);
            return Ok(version.to_string());
        }
    }

    let version_response: VersionResponse =
        serde_json::from_value(data).context("无法解析服务版本数据")?;

    logging!(
        info,
        Type::Service,
        true,
        "获取到服务版本: {}",
        version_response.version
    );
    Ok(version_response.version)
}

/// 检查服务是否需要重装
pub async fn check_service_needs_reinstall() -> bool {
    let service_state = ServiceRecord::get().await;

    if !service_state.can_reinstall() {
        return false;
    }

    match check_service_version().await {
        Ok(version) => version != REQUIRED_SERVICE_VERSION,
        Err(_) => is_service_available().await.is_err(),
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

    if let Some(data) = &response.data {
        if let Some(code) = data.get("code").and_then(|c| c.as_u64()) {
            if code != 0 {
                let msg = data
                    .get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("未知错误");
                bail!("启动核心失败: {}", msg);
            }
        }
    }

    log::info!(target: "app", "服务成功启动核心");
    Ok(())
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    logging!(info, Type::Service, true, "正在尝试通过服务启动核心");

    // 先检查服务版本
    let version_check = match check_service_version().await {
        Ok(version) => {
            if version != REQUIRED_SERVICE_VERSION {
                logging!(
                    warn,
                    Type::Service,
                    true,
                    "服务版本不匹配: {} (要求: {})",
                    version,
                    REQUIRED_SERVICE_VERSION
                );
                false
            } else {
                logging!(info, Type::Service, true, "服务版本匹配");
                true
            }
        }
        Err(err) => {
            logging!(warn, Type::Service, true, "无法获取服务版本: {}", err);
            false
        }
    };

    // 如果版本匹配且服务可用，直接使用
    if version_check && is_service_available().await.is_ok() {
        logging!(info, Type::Service, true, "服务已运行且版本匹配，直接使用");
        return start_with_existing_service(config_file).await;
    }

    // 版本不匹配时尝试重装
    if !version_check {
        let service_state = ServiceRecord::get().await;
        if !service_state.can_reinstall() {
            logging!(
                warn,
                Type::Service,
                true,
                "版本不匹配但重装被限制，尝试强制使用"
            );
            return start_with_existing_service(config_file)
                .await
                .context("服务版本不匹配且无法重装");
        }

        logging!(info, Type::Service, true, "开始重装服务");
        reinstall_service().await?;
        return start_with_existing_service(config_file).await;
    }

    // 尝试启动现有服务
    if let Ok(()) = start_with_existing_service(config_file).await {
        return Ok(());
    }

    // 服务启动失败，检查是否需要重装
    if check_service_needs_reinstall().await {
        logging!(info, Type::Service, true, "服务需要重装");
        reinstall_service().await?;
        start_with_existing_service(config_file).await
    } else {
        bail!("Service is not available and cannot be reinstalled at this time")
    }
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

    if let Some(data) = &response.data {
        if let Some(code) = data.get("code").and_then(|c| c.as_u64()) {
            if code != 0 {
                let msg = data
                    .get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("未知错误");
                logging!(
                    error,
                    Type::Service,
                    true,
                    "停止核心失败: code={}, msg={}",
                    code,
                    msg
                );
                bail!("停止核心失败: {}", msg);
            }
        }
    }

    logging!(info, Type::Service, true, "服务成功停止核心");
    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    match check_ipc_service_status().await {
        Ok(resp) => {
            if resp.code == 0 && resp.msg == "ok" && resp.data.is_some() {
                logging!(info, Type::Service, true, "service is running");
                Ok(())
            } else {
                logging!(
                    warn,
                    Type::Service,
                    true,
                    "服务未正常运行: code={}, msg={}",
                    resp.code,
                    resp.msg
                );
                Ok(())
            }
        }
        Err(err) => {
            logging!(error, Type::Service, true, "检查服务运行状态失败: {}", err);
            Err(err)
        }
    }
}

/// 综合服务状态检查（一次性完成所有检查）
pub async fn check_service_comprehensive() -> ServiceStatus {
    logging!(info, Type::Service, true, "开始综合服务状态检查");

    // 1. 检查用户偏好
    let service_state = ServiceRecord::get().await;
    if service_state.prefer_sidecar {
        logging!(info, Type::Service, true, "用户偏好Sidecar模式");
        return ServiceStatus::Unavailable("用户偏好Sidecar模式".to_string());
    }

    // 2. 检查服务是否可用
    match is_service_available().await {
        Ok(_) => {
            logging!(info, Type::Service, true, "服务当前可用，检查是否需要重装");

            // 3. 检查是否需要重装（版本不匹配等）
            if check_service_needs_reinstall().await {
                if service_state.can_reinstall() {
                    logging!(info, Type::Service, true, "服务需要重装且允许重装");
                    ServiceStatus::NeedsReinstall
                } else {
                    logging!(warn, Type::Service, true, "服务需要重装但被限制");
                    ServiceStatus::Unavailable("重装被限制".to_string())
                }
            } else {
                logging!(info, Type::Service, true, "服务就绪可用");
                ServiceStatus::Ready
            }
        }
        Err(_) => {
            logging!(warn, Type::Service, true, "服务不可用，检查安装状态");

            // 4. 检查是否从未安装过
            if service_state.last_install_time == 0 {
                logging!(info, Type::Service, true, "服务从未安装，需要首次安装");
                ServiceStatus::InstallRequired
            } else if service_state.can_reinstall() {
                logging!(info, Type::Service, true, "服务已安装但不可用，需要重装");
                ServiceStatus::NeedsReinstall
            } else {
                let reason = format!(
                    "服务已安装但不可用，重装被限制。上次错误: {}",
                    service_state
                        .last_error
                        .unwrap_or_else(|| "未知".to_string())
                );
                logging!(warn, Type::Service, true, "{}", reason);
                ServiceStatus::Unavailable(reason)
            }
        }
    }
}

/// 根据服务状态执行相应操作
pub async fn handle_service_status(status: ServiceStatus) -> Result<()> {
    match status {
        ServiceStatus::Ready => {
            logging!(info, Type::Service, true, "服务就绪，直接启动");
            Ok(())
        }
        ServiceStatus::NeedsReinstall | ServiceStatus::ReinstallRequired => {
            logging!(info, Type::Service, true, "服务需要重装，执行重装流程");
            reinstall_service().await?;
            update_service_state_to_service().await
        }
        ServiceStatus::ForceReinstallRequired => {
            logging!(
                info,
                Type::Service,
                true,
                "服务需要强制重装，执行强制重装流程"
            );
            force_reinstall_service().await?;
            update_service_state_to_service().await
        }
        ServiceStatus::InstallRequired => {
            logging!(info, Type::Service, true, "需要安装服务，执行安装流程");
            install_service().await?;
            update_service_state_to_service().await
        }
        ServiceStatus::UninstallRequired => {
            logging!(info, Type::Service, true, "服务需要卸载，执行卸载流程");
            uninstall_service().await?;
            update_service_state_to_sidecar("用户手动卸载服务").await
        }
        ServiceStatus::Unavailable(reason) => {
            logging!(
                info,
                Type::Service,
                true,
                "服务不可用: {}，将使用Sidecar模式",
                reason
            );
            Err(anyhow::anyhow!("服务不可用: {}", reason))
        }
    }
}

/// 更新服务状态为偏好Sidecar
async fn update_service_state_to_sidecar(reason: &str) -> Result<()> {
    logging!(
        info,
        Type::Service,
        true,
        "更新服务状态为偏好Sidecar，原因: {}",
        reason
    );
    let mut state = ServiceRecord::get().await;
    state.prefer_sidecar = true;
    state.last_error = Some(reason.to_string());
    if let Err(e) = state.save().await {
        logging!(error, Type::Service, true, "保存ServiceState失败: {}", e);
        return Err(e);
    }
    Ok(())
}

/// 更新服务状态在安装成功后
async fn update_service_state_to_service() -> Result<()> {
    logging!(info, Type::Service, true, "更新服务状态为使用Service");
    let mut state = ServiceRecord::get().await;
    state.record_install();
    state.prefer_sidecar = false;
    state.last_error = None;
    if let Err(e) = state.save().await {
        logging!(error, Type::Service, true, "保存ServiceState失败: {}", e);
        return Err(e);
    }
    Ok(())
}

/// 强制重装服务（UI修复按钮）
pub async fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "用户请求强制重装服务");

    let service_state = ServiceRecord::default();
    service_state.save().await?;

    logging!(info, Type::Service, true, "已重置服务状态，开始执行重装");

    reinstall_service().await.map_err(|err| {
        logging!(error, Type::Service, true, "强制重装服务失败: {}", err);
        err
    })
}

use crate::{
    config::Config,
    core::service_ipc::{send_ipc_request, IpcCommand},
    logging,
    utils::{dirs, logging::Type},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    env::current_exe,
    path::PathBuf,
    process::Command as StdCommand,
    time::{SystemTime, UNIX_EPOCH},
};

const REQUIRED_SERVICE_VERSION: &str = "1.1.0"; // 定义所需的服务版本号

// 限制重装时间和次数的常量
const REINSTALL_COOLDOWN_SECS: u64 = 300; // 5分钟冷却期
const MAX_REINSTALLS_PER_DAY: u32 = 3; // 每24小时最多重装3次
const ONE_DAY_SECS: u64 = 86400; // 24小时的秒数

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ServiceState {
    pub last_install_time: u64,     // 上次安装时间戳 (Unix 时间戳，秒)
    pub install_count: u32,         // 24小时内安装次数
    pub last_check_time: u64,       // 上次检查时间
    pub last_error: Option<String>, // 上次错误信息
    pub prefer_sidecar: bool,       // 用户是否偏好sidecar模式，如拒绝安装服务或安装失败
}

impl ServiceState {
    // 获取当前的服务状态
    pub fn get() -> Self {
        if let Some(state) = Config::verge().latest().service_state.clone() {
            return state;
        }
        Self::default()
    }

    // 保存服务状态
    pub fn save(&self) -> Result<()> {
        let config = Config::verge();
        let mut latest = config.latest().clone();
        latest.service_state = Some(self.clone());
        *config.draft() = latest;
        config.apply();
        let result = config.latest().save_file();
        result
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

#[cfg(target_os = "windows")]
pub async fn uninstall_service() -> Result<()> {
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
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub async fn install_service() -> Result<()> {
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
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub async fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "reinstall service");

    // 获取当前服务状态
    let mut service_state = ServiceState::get();

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
            service_state.save()?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {}", err);
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save()?;
            bail!(error)
        }
    }
}

#[cfg(target_os = "linux")]
pub async fn uninstall_service() -> Result<()> {
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
        status.code().unwrap()
    );

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
pub async fn install_service() -> Result<()> {
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
        status.code().unwrap()
    );

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
    logging!(info, Type::Service, true, "reinstall service");

    // 获取当前服务状态
    let mut service_state = ServiceState::get();

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
            service_state.save()?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {}", err);
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save()?;
            bail!(error)
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn uninstall_service() -> Result<()> {
    use crate::utils::i18n::t;

    logging!(info, Type::Service, true, "uninstall service");

    let binary_path = dirs::service_path()?;
    let uninstall_path = binary_path.with_file_name("uninstall-service");

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    let prompt = t("Service Administrator Prompt");
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
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn install_service() -> Result<()> {
    use crate::utils::i18n::t;

    logging!(info, Type::Service, true, "install service");

    let binary_path = dirs::service_path()?;
    let install_path = binary_path.with_file_name("install-service");

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let install_shell: String = install_path.to_string_lossy().into_owned();

    let prompt = t("Service Administrator Prompt");
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
            status.code().unwrap()
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, true, "reinstall service");

    // 获取当前服务状态
    let mut service_state = ServiceState::get();

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
            service_state.save()?;
            Ok(())
        }
        Err(err) => {
            let error = format!("failed to install service: {}", err);
            service_state.last_error = Some(error.clone());
            service_state.prefer_sidecar = true;
            service_state.save()?;
            bail!(error)
        }
    }
}

/// 检查服务状态 - 使用IPC通信
pub async fn check_ipc_service_status() -> Result<JsonResponse> {
    logging!(info, Type::Service, true, "开始检查服务状态 (IPC)");

    // 使用IPC通信
    let payload = serde_json::json!({});
    // logging!(debug, Type::Service, true, "发送GetClash请求");

    match send_ipc_request(IpcCommand::GetClash, payload).await {
        Ok(response) => {
            /*             logging!(
                debug,
                Type::Service,
                true,
                "收到GetClash响应: success={}, error={:?}",
                response.success,
                response.error
            ); */

            if !response.success {
                let err_msg = response.error.unwrap_or_else(|| "未知服务错误".to_string());
                logging!(error, Type::Service, true, "服务响应错误: {}", err_msg);
                bail!(err_msg);
            }

            match response.data {
                Some(data) => {
                    // 检查嵌套结构
                    if let (Some(code), Some(msg)) = (data.get("code"), data.get("msg")) {
                        let code_value = code.as_u64().unwrap_or(0);
                        let msg_value = msg.as_str().unwrap_or("ok").to_string();

                        // 提取嵌套的data字段并解析为ResponseBody
                        let response_body = if let Some(nested_data) = data.get("data") {
                            match serde_json::from_value::<ResponseBody>(nested_data.clone()) {
                                Ok(body) => Some(body),
                                Err(e) => {
                                    logging!(
                                        warn,
                                        Type::Service,
                                        true,
                                        "解析嵌套的ResponseBody失败: {}; 尝试其他方式",
                                        e
                                    );
                                    None
                                }
                            }
                        } else {
                            None
                        };

                        let json_response = JsonResponse {
                            code: code_value,
                            msg: msg_value,
                            data: response_body,
                        };

                        logging!(
                            info,
                            Type::Service,
                            true,
                            "服务检测成功: code={}, msg={}, data存在={}",
                            json_response.code,
                            json_response.msg,
                            json_response.data.is_some()
                        );
                        Ok(json_response)
                    } else {
                        // 尝试直接解析
                        match serde_json::from_value::<JsonResponse>(data.clone()) {
                            Ok(json_response) => {
                                logging!(
                                    info,
                                    Type::Service,
                                    true,
                                    "服务检测成功: code={}, msg={}",
                                    json_response.code,
                                    json_response.msg
                                );
                                Ok(json_response)
                            }
                            Err(e) => {
                                logging!(
                                    error,
                                    Type::Service,
                                    true,
                                    "解析服务响应失败: {}; 原始数据: {:?}",
                                    e,
                                    data
                                );
                                bail!("无法解析服务响应数据: {}", e)
                            }
                        }
                    }
                }
                None => {
                    logging!(error, Type::Service, true, "服务响应中没有数据");
                    bail!("服务响应中没有数据")
                }
            }
        }
        Err(e) => {
            logging!(error, Type::Service, true, "IPC通信失败: {}", e);
            bail!("无法连接到Clash Verge Service: {}", e)
        }
    }
}

/// 检查服务版本 - 使用IPC通信
pub async fn check_service_version() -> Result<String> {
    logging!(info, Type::Service, true, "开始检查服务版本 (IPC)");

    let payload = serde_json::json!({});
    // logging!(debug, Type::Service, true, "发送GetVersion请求");

    match send_ipc_request(IpcCommand::GetVersion, payload).await {
        Ok(response) => {
            /*             logging!(
                debug,
                Type::Service,
                true,
                "收到GetVersion响应: success={}, error={:?}",
                response.success,
                response.error
            ); */

            if !response.success {
                let err_msg = response
                    .error
                    .unwrap_or_else(|| "获取服务版本失败".to_string());
                logging!(error, Type::Service, true, "获取版本错误: {}", err_msg);
                bail!(err_msg);
            }

            match response.data {
                Some(data) => {
                    if let Some(nested_data) = data.get("data") {
                        if let Some(version) = nested_data.get("version") {
                            if let Some(version_str) = version.as_str() {
                                logging!(
                                    info,
                                    Type::Service,
                                    true,
                                    "获取到服务版本: {}",
                                    version_str
                                );
                                return Ok(version_str.to_string());
                            }
                        }
                        logging!(
                            error,
                            Type::Service,
                            true,
                            "嵌套数据中没有version字段: {:?}",
                            nested_data
                        );
                    } else {
                        // 兼容旧格式
                        match serde_json::from_value::<VersionResponse>(data.clone()) {
                            Ok(version_response) => {
                                logging!(
                                    info,
                                    Type::Service,
                                    true,
                                    "获取到服务版本: {}",
                                    version_response.version
                                );
                                return Ok(version_response.version);
                            }
                            Err(e) => {
                                logging!(
                                    error,
                                    Type::Service,
                                    true,
                                    "解析版本响应失败: {}; 原始数据: {:?}",
                                    e,
                                    data
                                );
                                bail!("无法解析服务版本数据: {}", e)
                            }
                        }
                    }
                    bail!("响应中未找到有效的版本信息")
                }
                None => {
                    logging!(error, Type::Service, true, "版本响应中没有数据");
                    bail!("服务版本响应中没有数据")
                }
            }
        }
        Err(e) => {
            logging!(error, Type::Service, true, "IPC通信失败: {}", e);
            bail!("无法连接到Clash Verge Service: {}", e)
        }
    }
}

/// 检查服务是否需要重装
pub async fn check_service_needs_reinstall() -> bool {
    logging!(info, Type::Service, true, "开始检查服务是否需要重装");

    let service_state = ServiceState::get();

    if !service_state.can_reinstall() {
        log::info!(target: "app", "服务重装检查: 处于冷却期或已达最大尝试次数");
        return false;
    }

    // 检查版本和可用性
    match check_service_version().await {
        Ok(version) => {
            log::info!(target: "app", "服务版本检测：当前={}, 要求={}", version, REQUIRED_SERVICE_VERSION);
            /*             logging!(
                info,
                Type::Service,
                true,
                "服务版本检测：当前={}, 要求={}",
                version,
                REQUIRED_SERVICE_VERSION
            ); */

            let needs_reinstall = version != REQUIRED_SERVICE_VERSION;
            if needs_reinstall {
                log::warn!(target: "app", "发现服务版本不匹配，需要重装! 当前={}, 要求={}",
                    version, REQUIRED_SERVICE_VERSION);
                logging!(warn, Type::Service, true, "服务版本不匹配，需要重装");

                // log::debug!(target: "app", "当前版本字节: {:?}", version.as_bytes());
                // log::debug!(target: "app", "要求版本字节: {:?}", REQUIRED_SERVICE_VERSION.as_bytes());
            } else {
                log::info!(target: "app", "服务版本匹配，无需重装");
                // logging!(info, Type::Service, true, "服务版本匹配，无需重装");
            }

            needs_reinstall
        }
        Err(err) => {
            logging!(error, Type::Service, true, "检查服务版本失败: {}", err);

            // 检查服务是否可用
            match is_service_available().await {
                Ok(()) => {
                    log::info!(target: "app", "服务正在运行但版本检查失败: {}", err);
                    /*                     logging!(
                        info,
                        Type::Service,
                        true,
                        "服务正在运行但版本检查失败: {}",
                        err
                    ); */
                    false
                }
                _ => {
                    log::info!(target: "app", "服务不可用或未运行，需要重装");
                    // logging!(info, Type::Service, true, "服务不可用或未运行，需要重装");
                    true
                }
            }
        }
    }
}

/// 尝试使用服务启动core
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    log::info!(target:"app", "尝试使用现有服务启动核心 (IPC)");
    // logging!(info, Type::Service, true, "尝试使用现有服务启动核心");

    let clash_core = Config::verge().latest().get_valid_clash_core();

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let clash_bin = format!("{clash_core}{bin_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;

    let log_path = dirs::service_log_file()?;
    let log_path = dirs::path_to_str(&log_path)?;

    let config_file = dirs::path_to_str(config_file)?;

    // 构建启动参数
    let payload = serde_json::json!({
        "core_type": clash_core,
        "bin_path": bin_path,
        "config_dir": config_dir,
        "config_file": config_file,
        "log_file": log_path,
    });

    // log::info!(target:"app", "启动服务参数: {:?}", payload);
    // logging!(info, Type::Service, true, "发送StartClash请求");

    // 使用IPC通信
    match send_ipc_request(IpcCommand::StartClash, payload).await {
        Ok(response) => {
            /*             logging!(
                info,
                Type::Service,
                true,
                "收到StartClash响应: success={}, error={:?}",
                response.success,
                response.error
            ); */

            if !response.success {
                let err_msg = response.error.unwrap_or_else(|| "启动核心失败".to_string());
                logging!(error, Type::Service, true, "启动核心失败: {}", err_msg);
                bail!(err_msg);
            }

            // 添加对嵌套JSON结构的处理
            if let Some(data) = &response.data {
                if let Some(code) = data.get("code") {
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
                            "启动核心返回错误: code={}, msg={}",
                            code_value,
                            msg
                        );
                        bail!("启动核心失败: {}", msg);
                    }
                }
            }

            logging!(info, Type::Service, true, "服务成功启动核心");
            Ok(())
        }
        Err(e) => {
            logging!(error, Type::Service, true, "启动核心IPC通信失败: {}", e);
            bail!("无法连接到Clash Verge Service: {}", e)
        }
    }
}

// 以服务启动core
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    log::info!(target: "app", "正在尝试通过服务启动核心");

    // 先检查服务版本，不受冷却期限制
    let version_check = match check_service_version().await {
        Ok(version) => {
            log::info!(target: "app", "检测到服务版本: {}, 要求版本: {}",
                version, REQUIRED_SERVICE_VERSION);

            if version.as_bytes() != REQUIRED_SERVICE_VERSION.as_bytes() {
                log::warn!(target: "app", "服务版本不匹配，需要重装");
                false
            } else {
                log::info!(target: "app", "服务版本匹配");
                true
            }
        }
        Err(err) => {
            log::warn!(target: "app", "无法获取服务版本: {}", err);
            false
        }
    };

    if version_check && is_service_available().await.is_ok() {
        log::info!(target: "app", "服务已在运行且版本匹配，尝试使用");
        return start_with_existing_service(config_file).await;
    }

    if !version_check {
        log::info!(target: "app", "服务版本不匹配，尝试重装");

        let service_state = ServiceState::get();
        if !service_state.can_reinstall() {
            log::warn!(target: "app", "由于限制无法重装服务");
            if let Ok(()) = start_with_existing_service(config_file).await {
                log::info!(target: "app", "尽管版本不匹配，但成功启动了服务");
                return Ok(());
            } else {
                bail!("服务版本不匹配且无法重装，启动失败");
            }
        }

        log::info!(target: "app", "开始重装服务");
        if let Err(err) = reinstall_service().await {
            log::warn!(target: "app", "服务重装失败: {}", err);

            log::info!(target: "app", "尝试使用现有服务");
            return start_with_existing_service(config_file).await;
        }

        log::info!(target: "app", "服务重装成功，尝试启动");
        return start_with_existing_service(config_file).await;
    }

    // 检查服务状态
    match check_ipc_service_status().await {
        Ok(_) => {
            log::info!(target: "app", "服务可用但未运行核心，尝试启动");
            if let Ok(()) = start_with_existing_service(config_file).await {
                return Ok(());
            }
        }
        Err(err) => {
            log::warn!(target: "app", "服务检查失败: {}", err);
        }
    }

    // 服务不可用或启动失败，检查是否需要重装
    if check_service_needs_reinstall().await {
        log::info!(target: "app", "服务需要重装");

        if let Err(err) = reinstall_service().await {
            log::warn!(target: "app", "服务重装失败: {}", err);
            bail!("Failed to reinstall service: {}", err);
        }

        log::info!(target: "app", "服务重装完成，尝试启动核心");
        start_with_existing_service(config_file).await
    } else {
        log::warn!(target: "app", "服务不可用且无法重装");
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
        bail!(response.error.unwrap_or_else(|| "停止核心失败".to_string()));
    }

    if let Some(data) = &response.data {
        if let Some(code) = data.get("code") {
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
    }

    Ok(())
}

/// 检查服务是否正在运行
pub async fn is_service_available() -> Result<()> {
    logging!(info, Type::Service, true, "开始检查服务是否正在运行");

    match check_ipc_service_status().await {
        Ok(resp) => {
            if resp.code == 0 && resp.msg == "ok" && resp.data.is_some() {
                logging!(info, Type::Service, true, "服务正在运行");
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

/// 强制重装服务（UI修复按钮）
pub async fn force_reinstall_service() -> Result<()> {
    log::info!(target: "app", "用户请求强制重装服务");

    let service_state = ServiceState::default();
    service_state.save()?;

    log::info!(target: "app", "已重置服务状态，开始执行重装");

    match reinstall_service().await {
        Ok(()) => {
            log::info!(target: "app", "服务重装成功");
            Ok(())
        }
        Err(err) => {
            log::error!(target: "app", "强制重装服务失败: {}", err);
            bail!("强制重装服务失败: {}", err)
        }
    }
}
/*
/// 彻底诊断服务状态，检查安装状态、IPC通信和服务版本
 pub async fn diagnose_service() -> Result<()> {
    logging!(info, Type::Service, true, "============= 开始服务诊断 =============");

    // 1. 检查服务文件是否存在
    let service_path = dirs::service_path();
    match service_path {
        Ok(path) => {
            let service_exists = path.exists();
            logging!(info, Type::Service, true, "服务可执行文件路径: {:?}, 存在: {}", path, service_exists);

            if !service_exists {
                logging!(error, Type::Service, true, "服务可执行文件不存在，需要重新安装");
                bail!("服务可执行文件不存在，需要重新安装");
            }

            // 检查服务版本文件
            let version_file = path.with_file_name("version.txt");
            if version_file.exists() {
                match std::fs::read_to_string(&version_file) {
                    Ok(content) => {
                        logging!(info, Type::Service, true, "服务版本文件内容: {}", content.trim());
                    }
                    Err(e) => {
                        logging!(warn, Type::Service, true, "读取服务版本文件失败: {}", e);
                    }
                }
            } else {
                logging!(warn, Type::Service, true, "服务版本文件不存在: {:?}", version_file);
            }
        }
        Err(e) => {
            logging!(error, Type::Service, true, "获取服务路径失败: {}", e);
            bail!("获取服务路径失败: {}", e);
        }
    }

    // 2. 检查IPC通信 - 命名管道/Unix套接字
    let socket_path = if cfg!(windows) {
        r"\\.\pipe\clash-verge-service"
    } else {
        "/tmp/clash-verge-service.sock"
    };

    logging!(info, Type::Service, true, "IPC通信路径: {}", socket_path);

    if !cfg!(windows) {
        // Unix系统检查套接字文件是否存在
        let socket_exists = std::path::Path::new(socket_path).exists();
        logging!(info, Type::Service, true, "Unix套接字文件是否存在: {}", socket_exists);

        if !socket_exists {
            logging!(warn, Type::Service, true, "Unix套接字文件不存在，服务可能未运行");
        }
    }

    // 3. 尝试通过IPC检查服务状态
    logging!(info, Type::Service, true, "尝试通过IPC通信检查服务状态...");
    match check_service().await {
        Ok(resp) => {
            logging!(info, Type::Service, true, "服务状态检查成功: code={}, msg={}", resp.code, resp.msg);

            // 4. 检查服务版本
            match check_service_version().await {
                Ok(version) => {
                    logging!(info, Type::Service, true, "服务版本: {}, 要求版本: {}",
                        version, REQUIRED_SERVICE_VERSION);

                    if version != REQUIRED_SERVICE_VERSION {
                        logging!(warn, Type::Service, true, "服务版本不匹配，建议重装服务");
                    } else {
                        logging!(info, Type::Service, true, "服务版本匹配");
                    }
                }
                Err(err) => {
                    logging!(error, Type::Service, true, "检查服务版本失败: {}", err);
                }
            }
        }
        Err(err) => {
            logging!(error, Type::Service, true, "服务状态检查失败: {}", err);

            // 5. 检查系统服务状态 - Windows专用
            #[cfg(windows)]
            {
                use std::process::Command;
                logging!(info, Type::Service, true, "尝试检查Windows服务状态...");

                let output = Command::new("sc")
                    .args(["query", "clash_verge_service"])
                    .output();

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let contains_running = stdout.contains("RUNNING");

                        logging!(info, Type::Service, true, "Windows服务查询结果: {}",
                            if contains_running { "正在运行" } else { "未运行" });

                        if !contains_running {
                            logging!(info, Type::Service, true, "服务输出: {}", stdout);
                        }
                    }
                    Err(e) => {
                        logging!(error, Type::Service, true, "检查Windows服务状态失败: {}", e);
                    }
                }
            }

            // macOS专用
            #[cfg(target_os = "macos")]
            {
                use std::process::Command;
                logging!(info, Type::Service, true, "尝试检查macOS服务状态...");

                let output = Command::new("launchctl")
                    .args(["list", "io.github.clash-verge-rev.clash-verge-rev.service"])
                    .output();

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let stderr = String::from_utf8_lossy(&out.stderr);

                        if out.status.success() {
                            logging!(info, Type::Service, true, "macOS服务正在运行");
                            logging!(debug, Type::Service, true, "服务详情: {}", stdout);
                        } else {
                            logging!(warn, Type::Service, true, "macOS服务未运行");
                            if !stderr.is_empty() {
                                logging!(info, Type::Service, true, "错误信息: {}", stderr);
                            }
                        }
                    }
                    Err(e) => {
                        logging!(error, Type::Service, true, "检查macOS服务状态失败: {}", e);
                    }
                }
            }

            // Linux专用
            #[cfg(target_os = "linux")]
            {
                use std::process::Command;
                logging!(info, Type::Service, true, "尝试检查Linux服务状态...");

                let output = Command::new("systemctl")
                    .args(["status", "clash_verge_service"])
                    .output();

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let is_active = stdout.contains("Active: active (running)");

                        logging!(info, Type::Service, true, "Linux服务状态: {}",
                            if is_active { "活跃运行中" } else { "未运行" });

                        if !is_active {
                            logging!(info, Type::Service, true, "服务状态详情: {}", stdout);
                        }
                    }
                    Err(e) => {
                        logging!(error, Type::Service, true, "检查Linux服务状态失败: {}", e);
                    }
                }
            }
        }
    }

    logging!(info, Type::Service, true, "============= 服务诊断完成 =============");
    Ok(())
} */

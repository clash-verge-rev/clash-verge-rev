use crate::{config::Config, utils::dirs};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env::current_exe, path::PathBuf, process::Command as StdCommand, time::{SystemTime, UNIX_EPOCH}};
use tokio::time::Duration;

// Windows only

const SERVICE_URL: &str = "http://127.0.0.1:33211";
const REQUIRED_SERVICE_VERSION: &str = "1.0.5"; // 定义所需的服务版本号

// 限制重装时间和次数的常量
const REINSTALL_COOLDOWN_SECS: u64 = 300; // 5分钟冷却期
const MAX_REINSTALLS_PER_DAY: u32 = 3;    // 每24小时最多重装3次
const ONE_DAY_SECS: u64 = 86400;         // 24小时的秒数

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct ServiceState {
    pub last_install_time: u64,       // 上次安装时间戳 (Unix 时间戳，秒)
    pub install_count: u32,           // 24小时内安装次数
    pub last_check_time: u64,         // 上次检查时间
    pub last_error: Option<String>,   // 上次错误信息
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
        Config::verge().latest().save_file()
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
        if now - self.last_install_time < ONE_DAY_SECS && self.install_count >= MAX_REINSTALLS_PER_DAY {
            return false;
        }
        
        true
    }
}

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

    // 获取当前服务状态
    let mut service_state = ServiceState::get();
    
    // 检查是否允许重装
    if !service_state.can_reinstall() {
        log::warn!(target:"app", "service reinstall rejected: cooldown period or max attempts reached");
        bail!("Service reinstallation is rate limited. Please try again later.");
    }

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
        let error = format!(
            "failed to install service with status {}",
            status.code().unwrap()
        );
        service_state.last_error = Some(error.clone());
        service_state.save()?;
        bail!(error);
    }

    // 记录安装信息并保存
    service_state.record_install();
    service_state.last_error = None;
    service_state.save()?;

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

    // 记录安装信息并保存
    let mut service_state = ServiceState::get();
    service_state.record_install();
    service_state.last_error = None;
    service_state.save()?;

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
        if Config::verge().latest().language.as_deref() == Some("zh")
            || Config::verge().latest().language.is_none()
        {
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

    // 记录安装信息并保存
    let mut service_state = ServiceState::get();
    service_state.record_install();
    service_state.last_error = None;
    service_state.save()?;
    
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
    // 获取当前服务状态
    let service_state = ServiceState::get();
    
    // 首先检查是否在冷却期或超过重装次数限制
    if !service_state.can_reinstall() {
        log::info!(target: "app", "service reinstall check: in cooldown period or max attempts reached");
        return false;
    }

    // 然后才检查版本和可用性
    match check_service_version().await {
        Ok(version) => {
            // 打印更详细的日志，方便排查问题
            log::info!(target: "app", "服务版本检测：当前={}, 要求={}", version, REQUIRED_SERVICE_VERSION);
            
            let needs_reinstall = version != REQUIRED_SERVICE_VERSION;
            if needs_reinstall {
                log::warn!(target: "app", "发现服务版本不匹配，需要重装! 当前={}, 要求={}", 
                    version, REQUIRED_SERVICE_VERSION);
                
                // 打印版本字符串的原始字节，确认没有隐藏字符
                log::debug!(target: "app", "当前版本字节: {:?}", version.as_bytes());
                log::debug!(target: "app", "要求版本字节: {:?}", REQUIRED_SERVICE_VERSION.as_bytes());
            } else {
                log::info!(target: "app", "服务版本匹配，无需重装");
            }
            
            needs_reinstall
        },
        Err(err) => {
            // 检查服务是否可用，如果可用但版本检查失败，可能只是版本API有问题
            match is_service_running().await {
                Ok(true) => {
                    log::info!(target: "app", "service is running but version check failed: {}", err);
                    false // 服务在运行，不需要重装
                }
                _ => {
                    log::info!(target: "app", "service is not running or unavailable");
                    true // 服务不可用，需要重装
                }
            }
        }
    }
}

/// 尝试使用现有服务启动核心，不进行重装
pub(super) async fn start_with_existing_service(config_file: &PathBuf) -> Result<()> {
    log::info!(target:"app", "attempting to start core with existing service");

    let clash_core = { Config::verge().latest().clash_core.clone() };
    let clash_core = clash_core.unwrap_or("verge-mihomo".into());

    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    let clash_bin = format!("{clash_core}{bin_ext}");
    let bin_path = current_exe()?.with_file_name(clash_bin);
    let bin_path = dirs::path_to_str(&bin_path)?;

    let config_dir = dirs::app_home_dir()?;
    let config_dir = dirs::path_to_str(&config_dir)?;
    #[cfg(target_os = "linux")]
    let config_dir = &(config_dir.replace("/verge-mihomo", "") + "/resources");

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

/// start the clash by service
pub(super) async fn run_core_by_service(config_file: &PathBuf) -> Result<()> {
    log::info!(target: "app", "正在尝试通过服务启动核心");

    // 先检查服务版本，不受冷却期限制
    let version_check = match check_service_version().await {
        Ok(version) => {
            log::info!(target: "app", "检测到服务版本: {}, 要求版本: {}", 
                version, REQUIRED_SERVICE_VERSION);
            
            // 通过字节比较确保完全匹配
            if version.as_bytes() != REQUIRED_SERVICE_VERSION.as_bytes() {
                log::warn!(target: "app", "服务版本不匹配，需要重装");
                false // 版本不匹配
            } else {
                log::info!(target: "app", "服务版本匹配");
                true // 版本匹配
            }
        },
        Err(err) => {
            log::warn!(target: "app", "无法获取服务版本: {}", err);
            false // 无法获取版本
        }
    };

    // 先尝试直接启动服务，如果服务可用且版本匹配
    if version_check {
        if let Ok(true) = is_service_running().await {
            // 服务正在运行且版本匹配，直接使用
            log::info!(target: "app", "服务已在运行且版本匹配，尝试使用");
            return start_with_existing_service(config_file).await;
        }
    }
    
    // 强制执行版本检查，如果版本不匹配则重装
    if !version_check {
        log::info!(target: "app", "服务版本不匹配，尝试重装");
        
        // 获取服务状态，检查是否可以重装
        let service_state = ServiceState::get();
        if !service_state.can_reinstall() {
            log::warn!(target: "app", "由于限制无法重装服务");
            // 尝试直接启动，即使版本不匹配
            if let Ok(()) = start_with_existing_service(config_file).await {
                log::info!(target: "app", "尽管版本不匹配，但成功启动了服务");
                return Ok(());
            } else {
                bail!("服务版本不匹配且无法重装，启动失败");
            }
        }
        
        // 尝试重装
        log::info!(target: "app", "开始重装服务");
        if let Err(err) = reinstall_service().await {
            log::warn!(target: "app", "服务重装失败: {}", err);
            
            // 尝试使用现有服务
            log::info!(target: "app", "尝试使用现有服务");
            return start_with_existing_service(config_file).await;
        }
        
        // 重装成功，尝试启动
        log::info!(target: "app", "服务重装成功，尝试启动");
        return start_with_existing_service(config_file).await;
    }
    
    // 检查服务状态
    match check_service().await {
        Ok(_) => {
            // 服务可访问但可能没有运行核心，尝试直接启动
            log::info!(target: "app", "服务可用但未运行核心，尝试启动");
            if let Ok(()) = start_with_existing_service(config_file).await {
                return Ok(());
            }
        },
        Err(err) => {
            log::warn!(target: "app", "服务检查失败: {}", err);
        }
    }
    
    // 服务不可用或启动失败，检查是否需要重装
    if check_service_needs_reinstall().await {
        log::info!(target: "app", "服务需要重装");
        
        // 尝试重装
        if let Err(err) = reinstall_service().await {
            log::warn!(target: "app", "服务重装失败: {}", err);
            bail!("Failed to reinstall service: {}", err);
        }
        
        // 重装后再次尝试启动
        log::info!(target: "app", "服务重装完成，尝试启动核心");
        start_with_existing_service(config_file).await
    } else {
        // 不需要或不能重装，返回错误
        log::warn!(target: "app", "服务不可用且无法重装");
        bail!("Service is not available and cannot be reinstalled at this time")
    }
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
    if resp.code == 0 && resp.msg == "ok" && resp.data.is_some() {
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 强制重装服务（用于UI中的修复服务按钮）
pub async fn force_reinstall_service() -> Result<()> {
    log::info!(target: "app", "用户请求强制重装服务");

    // 创建默认服务状态（重置所有限制）
    let service_state = ServiceState::default();
    service_state.save()?;
    
    log::info!(target: "app", "已重置服务状态，开始执行重装");
    
    // 执行重装
    match reinstall_service().await {
        Ok(()) => {
            log::info!(target: "app", "服务重装成功");
            Ok(())
        },
        Err(err) => {
            log::error!(target: "app", "强制重装服务失败: {}", err);
            bail!("强制重装服务失败: {}", err)
        }
    }
}

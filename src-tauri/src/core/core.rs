#[cfg(target_os = "macos")]
use crate::core::tray::Tray;
use crate::{
    config::*,
    core::{
        handle,
        service::{self},
    },
    logging, logging_error,
    module::mihomo::MihomoManager,
    utils::{
        dirs,
        help::{self},
        logging::Type,
    },
};
use anyhow::Result;
use chrono::Local;
use once_cell::sync::OnceCell;
use std::{
    fmt,
    fs::{create_dir_all, File},
    io::Write,
    path::PathBuf,
    sync::Arc,
};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tokio::sync::Mutex;

#[derive(Debug)]
pub struct CoreManager {
    running: Arc<Mutex<RunningMode>>,
    child_sidecar: Arc<Mutex<Option<CommandChild>>>,
}

/// 内核运行模式
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub enum RunningMode {
    /// 服务模式运行
    Service,
    /// Sidecar 模式运行
    Sidecar,
    /// 未运行
    NotRunning,
}

impl fmt::Display for RunningMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RunningMode::Service => write!(f, "Service"),
            RunningMode::Sidecar => write!(f, "Sidecar"),
            RunningMode::NotRunning => write!(f, "NotRunning"),
        }
    }
}

use crate::config::IVerge;

impl CoreManager {
    /// 检查文件是否为脚本文件
    fn is_script_file(&self, path: &str) -> Result<bool> {
        // 1. 先通过扩展名快速判断
        if path.ends_with(".yaml") || path.ends_with(".yml") {
            return Ok(false); // YAML文件不是脚本文件
        } else if path.ends_with(".js") {
            return Ok(true); // JS文件是脚本文件
        }

        // 2. 读取文件内容
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                logging!(
                    warn,
                    Type::Config,
                    true,
                    "无法读取文件以检测类型: {}, 错误: {}",
                    path,
                    err
                );
                return Err(anyhow::anyhow!(
                    "Failed to read file to detect type: {}",
                    err
                ));
            }
        };

        // 3. 检查是否存在明显的YAML特征
        let has_yaml_features = content.contains(": ")
            || content.contains("#")
            || content.contains("---")
            || content.lines().any(|line| line.trim().starts_with("- "));

        // 4. 检查是否存在明显的JS特征
        let has_js_features = content.contains("function ")
            || content.contains("const ")
            || content.contains("let ")
            || content.contains("var ")
            || content.contains("//")
            || content.contains("/*")
            || content.contains("*/")
            || content.contains("export ")
            || content.contains("import ");

        // 5. 决策逻辑
        if has_yaml_features && !has_js_features {
            // 只有YAML特征，没有JS特征
            return Ok(false);
        } else if has_js_features && !has_yaml_features {
            // 只有JS特征，没有YAML特征
            return Ok(true);
        } else if has_yaml_features && has_js_features {
            // 两种特征都有，需要更精细判断
            // 优先检查是否有明确的JS结构特征
            if content.contains("function main")
                || content.contains("module.exports")
                || content.contains("export default")
            {
                return Ok(true);
            }

            // 检查冒号后是否有空格（YAML的典型特征）
            let yaml_pattern_count = content.lines().filter(|line| line.contains(": ")).count();

            if yaml_pattern_count > 2 {
                return Ok(false); // 多个键值对格式，更可能是YAML
            }
        }

        // 默认情况：无法确定时，假设为非脚本文件（更安全）
        logging!(
            debug,
            Type::Config,
            true,
            "无法确定文件类型，默认当作YAML处理: {}",
            path
        );
        Ok(false)
    }
    /// 使用默认配置
    pub async fn use_default_config(&self, msg_type: &str, msg_content: &str) -> Result<()> {
        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        *Config::runtime().draft() = Box::new(IRuntime {
            config: Some(Config::clash().latest().0.clone()),
            exists_keys: vec![],
            chain_logs: Default::default(),
        });
        help::save_yaml(
            &runtime_path,
            &Config::clash().latest().0,
            Some("# Clash Verge Runtime"),
        )?;
        handle::Handle::notice_message(msg_type, msg_content);
        Ok(())
    }
    /// 验证运行时配置
    pub async fn validate_config(&self) -> Result<(bool, String)> {
        logging!(info, Type::Config, true, "生成临时配置文件用于验证");
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;
        self.validate_config_internal(config_path).await
    }
    /// 验证指定的配置文件
    pub async fn validate_config_file(
        &self,
        config_path: &str,
        is_merge_file: Option<bool>,
    ) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过验证
        if handle::Handle::global().is_exiting() {
            logging!(info, Type::Core, true, "应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        // 检查文件是否存在
        if !std::path::Path::new(config_path).exists() {
            let error_msg = format!("File not found: {}", config_path);
            //handle::Handle::notice_message("config_validate::file_not_found", &error_msg);
            return Ok((false, error_msg));
        }

        // 如果是合并文件且不是强制验证，执行语法检查但不进行完整验证
        if is_merge_file.unwrap_or(false) {
            logging!(
                info,
                Type::Config,
                true,
                "检测到Merge文件，仅进行语法检查: {}",
                config_path
            );
            return self.validate_file_syntax(config_path).await;
        }

        // 检查是否为脚本文件
        let is_script = if config_path.ends_with(".js") {
            true
        } else {
            match self.is_script_file(config_path) {
                Ok(result) => result,
                Err(err) => {
                    // 如果无法确定文件类型，尝试使用Clash内核验证
                    logging!(
                        warn,
                        Type::Config,
                        true,
                        "无法确定文件类型: {}, 错误: {}",
                        config_path,
                        err
                    );
                    return self.validate_config_internal(config_path).await;
                }
            }
        };

        if is_script {
            logging!(
                info,
                Type::Config,
                true,
                "检测到脚本文件，使用JavaScript验证: {}",
                config_path
            );
            return self.validate_script_file(config_path).await;
        }

        // 对YAML配置文件使用Clash内核验证
        logging!(
            info,
            Type::Config,
            true,
            "使用Clash内核验证配置文件: {}",
            config_path
        );
        self.validate_config_internal(config_path).await
    }
    /// 内部验证配置文件的实现
    async fn validate_config_internal(&self, config_path: &str) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过验证
        if handle::Handle::global().is_exiting() {
            logging!(info, Type::Core, true, "应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        logging!(
            info,
            Type::Config,
            true,
            "开始验证配置文件: {}",
            config_path
        );

        let clash_core = Config::verge().latest().get_valid_clash_core();
        logging!(info, Type::Config, true, "使用内核: {}", clash_core);

        let app_handle = handle::Handle::global().app_handle().unwrap();
        let app_dir = dirs::app_home_dir()?;
        let app_dir_str = dirs::path_to_str(&app_dir)?;
        logging!(info, Type::Config, true, "验证目录: {}", app_dir_str);

        // 使用子进程运行clash验证配置
        let output = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-t", "-d", app_dir_str, "-f", config_path])
            .output()
            .await?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);

        // 检查进程退出状态和错误输出
        let error_keywords = ["FATA", "fatal", "Parse config error", "level=fatal"];
        let has_error =
            !output.status.success() || error_keywords.iter().any(|&kw| stderr.contains(kw));

        logging!(info, Type::Config, true, "-------- 验证结果 --------");

        if !stderr.is_empty() {
            logging!(info, Type::Config, true, "stderr输出:\n{}", stderr);
        }

        if has_error {
            logging!(info, Type::Config, true, "发现错误，开始处理错误信息");
            let error_msg = if !stdout.is_empty() {
                stdout.to_string()
            } else if !stderr.is_empty() {
                stderr.to_string()
            } else if let Some(code) = output.status.code() {
                format!("验证进程异常退出，退出码: {}", code)
            } else {
                "验证进程被终止".to_string()
            };

            logging!(info, Type::Config, true, "-------- 验证结束 --------");
            Ok((false, error_msg)) // 返回错误消息给调用者处理
        } else {
            logging!(info, Type::Config, true, "验证成功");
            logging!(info, Type::Config, true, "-------- 验证结束 --------");
            Ok((true, String::new()))
        }
    }
    /// 只进行文件语法检查，不进行完整验证
    async fn validate_file_syntax(&self, config_path: &str) -> Result<(bool, String)> {
        logging!(info, Type::Config, true, "开始检查文件: {}", config_path);

        // 读取文件内容
        let content = match std::fs::read_to_string(config_path) {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read file: {}", err);
                logging!(error, Type::Config, true, "无法读取文件: {}", error_msg);
                return Ok((false, error_msg));
            }
        };
        // 对YAML文件尝试解析，只检查语法正确性
        logging!(info, Type::Config, true, "进行YAML语法检查");
        match serde_yaml::from_str::<serde_yaml::Value>(&content) {
            Ok(_) => {
                logging!(info, Type::Config, true, "YAML语法检查通过");
                Ok((true, String::new()))
            }
            Err(err) => {
                // 使用标准化的前缀，以便错误处理函数能正确识别
                let error_msg = format!("YAML syntax error: {}", err);
                logging!(error, Type::Config, true, "YAML语法错误: {}", error_msg);
                Ok((false, error_msg))
            }
        }
    }
    /// 验证脚本文件语法
    async fn validate_script_file(&self, path: &str) -> Result<(bool, String)> {
        // 读取脚本内容
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read script file: {}", err);
                logging!(warn, Type::Config, true, "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                return Ok((false, error_msg));
            }
        };

        logging!(debug, Type::Config, true, "验证脚本文件: {}", path);

        // 使用boa引擎进行基本语法检查
        use boa_engine::{Context, Source};

        let mut context = Context::default();
        let result = context.eval(Source::from_bytes(&content));

        match result {
            Ok(_) => {
                logging!(debug, Type::Config, true, "脚本语法验证通过: {}", path);

                // 检查脚本是否包含main函数
                if !content.contains("function main")
                    && !content.contains("const main")
                    && !content.contains("let main")
                {
                    let error_msg = "Script must contain a main function";
                    logging!(warn, Type::Config, true, "脚本缺少main函数: {}", path);
                    //handle::Handle::notice_message("config_validate::script_missing_main", error_msg);
                    return Ok((false, error_msg.to_string()));
                }

                Ok((true, String::new()))
            }
            Err(err) => {
                let error_msg = format!("Script syntax error: {}", err);
                logging!(warn, Type::Config, true, "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                Ok((false, error_msg))
            }
        }
    }
    /// 更新proxies等配置
    pub async fn update_config(&self) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过完整验证流程
        if handle::Handle::global().is_exiting() {
            logging!(info, Type::Config, true, "应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        logging!(info, Type::Config, true, "开始更新配置");

        // 1. 先生成新的配置内容
        logging!(info, Type::Config, true, "生成新的配置内容");
        Config::generate().await?;

        // 2. 验证配置
        match self.validate_config().await {
            Ok((true, _)) => {
                logging!(info, Type::Config, true, "配置验证通过");
                // 4. 验证通过后，生成正式的运行时配置
                logging!(info, Type::Config, true, "生成运行时配置");
                let run_path = Config::generate_file(ConfigType::Run)?;
                logging_error!(Type::Config, true, self.put_configs_force(run_path).await);
                Ok((true, "something".into()))
            }
            Ok((false, error_msg)) => {
                logging!(warn, Type::Config, true, "配置验证失败: {}", error_msg);
                Config::runtime().discard();
                Ok((false, error_msg))
            }
            Err(e) => {
                logging!(warn, Type::Config, true, "验证过程发生错误: {}", e);
                Config::runtime().discard();
                Err(e)
            }
        }
    }
    pub async fn put_configs_force(&self, path_buf: PathBuf) -> Result<(), String> {
        let run_path_str = dirs::path_to_str(&path_buf).map_err(|e| {
            let msg = e.to_string();
            logging_error!(Type::Core, true, "{}", msg);
            msg
        });
        match MihomoManager::global()
            .put_configs_force(run_path_str?)
            .await
        {
            Ok(_) => {
                Config::runtime().apply();
                logging!(info, Type::Core, true, "Configuration updated successfully");
                Ok(())
            }
            Err(e) => {
                let msg = e.to_string();
                Config::runtime().discard();
                logging_error!(Type::Core, true, "Failed to update configuration: {}", msg);
                Err(msg)
            }
        }
    }
}

impl CoreManager {
    async fn start_core_by_sidecar(&self) -> Result<()> {
        logging!(trace, Type::Core, true, "Running core by sidecar");
        let config_file = &Config::generate_file(ConfigType::Run)?;
        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or(anyhow::anyhow!("failed to get app handle"))?;
        let clash_core = Config::verge().latest().get_valid_clash_core();
        let config_dir = dirs::app_home_dir()?;

        let service_log_dir = dirs::app_home_dir()?.join("logs").join("service");
        create_dir_all(&service_log_dir)?;

        let now = Local::now();
        let timestamp = now.format("%Y%m%d_%H%M%S").to_string();

        let log_path = service_log_dir.join(format!("sidecar_{}.log", timestamp));

        let mut log_file = File::create(log_path)?;

        let (mut rx, child) = app_handle
            .shell()
            .sidecar(&clash_core)?
            .args([
                "-d",
                dirs::path_to_str(&config_dir)?,
                "-f",
                dirs::path_to_str(config_file)?,
            ])
            .spawn()?;

        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
                    if let Err(e) = writeln!(log_file, "{}", String::from_utf8_lossy(&line)) {
                        logging!(
                            error,
                            Type::Core,
                            true,
                            "[Sidecar] Failed to write stdout to file: {}",
                            e
                        );
                    }
                }
            }
        });

        let pid = child.pid();
        logging!(
            trace,
            Type::Core,
            true,
            "Started core by sidecar pid: {}",
            pid
        );
        *self.child_sidecar.lock().await = Some(child);
        self.set_running_mode(RunningMode::Sidecar).await;
        Ok(())
    }
    async fn stop_core_by_sidecar(&self) -> Result<()> {
        logging!(trace, Type::Core, true, "Stopping core by sidecar");

        if let Some(child) = self.child_sidecar.lock().await.take() {
            let pid = child.pid();
            child.kill()?;
            logging!(
                trace,
                Type::Core,
                true,
                "Stopped core by sidecar pid: {}",
                pid
            );
        }
        self.set_running_mode(RunningMode::NotRunning).await;
        Ok(())
    }
}

impl CoreManager {
    async fn start_core_by_service(&self) -> Result<()> {
        logging!(trace, Type::Core, true, "Running core by service");
        let config_file = &Config::generate_file(ConfigType::Run)?;
        service::run_core_by_service(config_file).await?;
        self.set_running_mode(RunningMode::Service).await;
        Ok(())
    }
    async fn stop_core_by_service(&self) -> Result<()> {
        logging!(trace, Type::Core, true, "Stopping core by service");
        service::stop_core_by_service().await?;
        self.set_running_mode(RunningMode::NotRunning).await;
        Ok(())
    }
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();
        CORE_MANAGER.get_or_init(|| CoreManager {
            running: Arc::new(Mutex::new(RunningMode::NotRunning)),
            child_sidecar: Arc::new(Mutex::new(None)),
        })
    }
    // 当服务安装失败时的回退逻辑
    async fn attempt_service_init(&self) -> Result<()> {
        if service::check_service_needs_reinstall().await {
            logging!(info, Type::Core, true, "服务版本不匹配或状态异常，执行重装");
            if let Err(e) = service::reinstall_service().await {
                logging!(
                    warn,
                    Type::Core,
                    true,
                    "服务重装失败 during attempt_service_init: {}",
                    e
                );
                return Err(e);
            }
            // 如果重装成功，还需要尝试启动服务
            logging!(info, Type::Core, true, "服务重装成功，尝试启动服务");
        }

        if let Err(e) = self.start_core_by_service().await {
            logging!(
                warn,
                Type::Core,
                true,
                "通过服务启动核心失败 during attempt_service_init: {}",
                e
            );
            // 确保 prefer_sidecar 在 start_core_by_service 失败时也被设置
            let mut state = service::ServiceState::get();
            if !state.prefer_sidecar {
                state.prefer_sidecar = true;
                state.last_error = Some(format!("通过服务启动核心失败: {}", e));
                if let Err(save_err) = state.save() {
                    logging!(
                        error,
                        Type::Core,
                        true,
                        "保存ServiceState失败 (in attempt_service_init/start_core_by_service): {}",
                        save_err
                    );
                }
            }
            return Err(e);
        }
        Ok(())
    }

    pub async fn init(&self) -> Result<()> {
        logging!(trace, Type::Core, "Initializing core");

        let mut core_started_successfully = false;

        if service::is_service_available().await.is_ok() {
            logging!(
                info,
                Type::Core,
                true,
                "服务当前可用或看似可用，尝试通过服务模式启动/重装"
            );
            match self.attempt_service_init().await {
                Ok(_) => {
                    logging!(info, Type::Core, true, "服务模式成功启动核心");
                    core_started_successfully = true;
                }
                Err(_err) => {
                    logging!(
                        warn,
                        Type::Core,
                        true,
                        "服务模式启动或重装失败。将尝试Sidecar模式回退。"
                    );
                }
            }
        } else {
            logging!(
                info,
                Type::Core,
                true,
                "服务初始不可用 (is_service_available 调用失败)"
            );
        }

        if !core_started_successfully {
            logging!(
                info,
                Type::Core,
                true,
                "核心未通过服务模式启动，执行Sidecar回退或首次安装逻辑"
            );

            let service_state = service::ServiceState::get();

            if service_state.prefer_sidecar {
                logging!(
                    info,
                    Type::Core,
                    true,
                    "用户偏好Sidecar模式或先前服务启动失败，使用Sidecar模式启动"
                );
                self.start_core_by_sidecar().await?;
                // 如果 sidecar 启动成功，我们可以认为核心初始化流程到此结束
                // 后续的 Tray::global().subscribe_traffic().await 仍然会执行
            } else {
                let has_service_install_record = service_state.last_install_time > 0;
                if !has_service_install_record {
                    logging!(
                        info,
                        Type::Core,
                        true,
                        "无服务安装记录 (首次运行或状态重置)，尝试安装服务"
                    );
                    match service::install_service().await {
                        Ok(_) => {
                            logging!(info, Type::Core, true, "服务安装成功(首次尝试)");
                            let mut new_state = service::ServiceState::default();
                            new_state.record_install();
                            new_state.prefer_sidecar = false;
                            new_state.save()?;

                            if service::is_service_available().await.is_ok() {
                                logging!(info, Type::Core, true, "新安装的服务可用，尝试启动");
                                if self.start_core_by_service().await.is_ok() {
                                    logging!(info, Type::Core, true, "新安装的服务启动成功");
                                } else {
                                    logging!(
                                        warn,
                                        Type::Core,
                                        true,
                                        "新安装的服务启动失败，回退到Sidecar模式"
                                    );
                                    let mut final_state = service::ServiceState::get();
                                    final_state.prefer_sidecar = true;
                                    final_state.last_error =
                                        Some("Newly installed service failed to start".to_string());
                                    final_state.save()?;
                                    self.start_core_by_sidecar().await?;
                                }
                            } else {
                                logging!(
                                    warn,
                                    Type::Core,
                                    true,
                                    "服务安装成功但未能连接/立即可用，回退到Sidecar模式"
                                );
                                let mut final_state = service::ServiceState::get();
                                final_state.prefer_sidecar = true;
                                final_state.last_error = Some(
                                    "Newly installed service not immediately available/connectable"
                                        .to_string(),
                                );
                                final_state.save()?;
                                self.start_core_by_sidecar().await?;
                            }
                        }
                        Err(err) => {
                            logging!(warn, Type::Core, true, "服务首次安装失败: {}", err);
                            let new_state = service::ServiceState {
                                last_error: Some(err.to_string()),
                                prefer_sidecar: true,
                                ..Default::default()
                            };
                            new_state.save()?;
                            self.start_core_by_sidecar().await?;
                        }
                    }
                } else {
                    // 有安装记录，服务未成功启动，且初始不偏好sidecar
                    // 这意味着服务之前可能可用，但 attempt_service_init 失败了（并应已设置 prefer_sidecar），
                    // 或者服务初始不可用，无偏好，有记录。应强制使用 sidecar。
                    logging!(
                        info,
                        Type::Core,
                        true,
                        "有服务安装记录但服务不可用/未启动，强制切换到Sidecar模式"
                    );
                    let mut final_state = service::ServiceState::get();
                    if !final_state.prefer_sidecar {
                        logging!(
                            warn,
                            Type::Core,
                            true,
                            "prefer_sidecar 为 false，因服务启动失败或不可用而强制设置为 true"
                        );
                        final_state.prefer_sidecar = true;
                        final_state.last_error =
                            Some(final_state.last_error.unwrap_or_else(|| {
                                "Service startup failed or unavailable before sidecar fallback"
                                    .to_string()
                            }));
                        final_state.save()?;
                    }
                    self.start_core_by_sidecar().await?;
                }
            }
        }

        logging!(trace, Type::Core, "Initied core logic completed");
        #[cfg(target_os = "macos")]
        logging_error!(Type::Core, true, Tray::global().subscribe_traffic().await);

        Ok(())
    }

    pub async fn set_running_mode(&self, mode: RunningMode) {
        let mut guard = self.running.lock().await;
        *guard = mode;
    }

    pub async fn get_running_mode(&self) -> RunningMode {
        let guard = self.running.lock().await;
        (*guard).clone()
    }

    /// 启动核心
    pub async fn start_core(&self) -> Result<()> {
        if service::is_service_available().await.is_ok() {
            if service::check_service_needs_reinstall().await {
                service::reinstall_service().await?;
            }
            logging!(info, Type::Core, true, "服务可用，使用服务模式启动");
            self.start_core_by_service().await?;
        } else {
            // 服务不可用，检查用户偏好
            let service_state = service::ServiceState::get();
            if service_state.prefer_sidecar {
                logging!(
                    info,
                    Type::Core,
                    true,
                    "服务不可用，根据用户偏好使用Sidecar模式"
                );
                self.start_core_by_sidecar().await?;
            } else {
                logging!(info, Type::Core, true, "服务不可用，使用Sidecar模式");
                self.start_core_by_sidecar().await?;
            }
        }
        Ok(())
    }

    /// 停止核心运行
    pub async fn stop_core(&self) -> Result<()> {
        match self.get_running_mode().await {
            RunningMode::Service => self.stop_core_by_service().await,
            RunningMode::Sidecar => self.stop_core_by_sidecar().await,
            RunningMode::NotRunning => Ok(()),
        }
    }

    /// 重启内核
    pub async fn restart_core(&self) -> Result<()> {
        self.stop_core().await?;
        self.start_core().await?;
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<(), String> {
        if clash_core.is_none() {
            let error_message = "Clash core should not be Null";
            logging!(error, Type::Core, true, "{}", error_message);
            return Err(error_message.to_string());
        }
        let core: &str = &clash_core.clone().unwrap();
        if !IVerge::VALID_CLASH_CORES.contains(&core) {
            let error_message = format!("Clash core invalid name: {}", core);
            logging!(error, Type::Core, true, "{}", error_message);
            return Err(error_message);
        }

        Config::verge().draft().clash_core = clash_core.clone();
        Config::verge().apply();
        logging_error!(Type::Core, true, Config::verge().latest().save_file());

        let run_path = Config::generate_file(ConfigType::Run).map_err(|e| {
            let msg = e.to_string();
            logging_error!(Type::Core, true, "{}", msg);
            msg
        })?;

        self.put_configs_force(run_path).await?;

        Ok(())
    }
}

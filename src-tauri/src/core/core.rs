#[cfg(target_os = "macos")]
use crate::core::tray::Tray;
use crate::{
    config::*,
    core::{handle, service},
    log_err,
    module::mihomo::MihomoManager,
    utils::{dirs, help},
};
use anyhow::{bail, Result};
use fs2::FileExt;
use once_cell::sync::OnceCell;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri_plugin_shell::ShellExt;
use tokio::{sync::Mutex, time::sleep};

use super::service::is_service_running;

#[derive(Debug)]
pub struct CoreManager {
    running: Arc<Mutex<bool>>,
    last_check_time: Arc<Mutex<Option<std::time::Instant>>>,
}

/// 内核运行模式
#[derive(Debug, Clone, serde::Serialize)]
pub enum RunningMode {
    /// 服务模式运行
    Service,
    /// Sidecar模式运行
    Sidecar,
    /// 未运行
    NotRunning,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();
        CORE_MANAGER.get_or_init(|| CoreManager {
            running: Arc::new(Mutex::new(false)),
            last_check_time: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn init(&self) -> Result<()> {
        log::trace!("run core start");
        // 启动clash
        log_err!(Self::global().start_core().await);
        log::trace!("run core end");
        Ok(())
    }

    /// 停止核心运行
    pub async fn stop_core(&self) -> Result<()> {
        let mut running = self.running.lock().await;

        if !*running {
            println!("[停止内核] 内核未运行");
            log::debug!("core is not running");
            return Ok(());
        }

        println!("[停止内核] 开始停止内核");

        // 关闭tun模式
        // Create a JSON object to disable TUN mode
        let disable = serde_json::json!({
            "tun": {
            "enable": false
            }
        });
        println!("[停止内核] 禁用TUN模式");
        log::debug!(target: "app", "disable tun mode");
        log_err!(MihomoManager::global().patch_configs(disable).await);

        // 服务模式
        if service::check_service().await.is_ok() {
            println!("[停止内核] 尝试通过服务停止内核");
            log::info!(target: "app", "stop the core by service");
            match service::stop_core_by_service().await {
                Ok(_) => {
                    println!("[停止内核] 服务模式下内核停止成功");
                    log::info!(target: "app", "core stopped successfully by service");
                }
                Err(err) => {
                    println!("[停止内核] 服务模式下停止内核失败: {}", err);
                    println!("[停止内核] 尝试停止可能的sidecar进程");
                    log::warn!(target: "app", "failed to stop core by service: {}", err);
                    // 服务停止失败，尝试停止可能的sidecar进程
                    self.stop_sidecar_process();
                }
            }
        } else {
            // 如果没有使用服务，尝试停止sidecar进程
            println!("[停止内核] 服务不可用，尝试停止sidecar进程");
            self.stop_sidecar_process();
        }

        // 释放文件锁
        println!("[停止内核] 尝试释放文件锁");
        if let Some(_) = handle::Handle::global().release_core_lock() {
            println!("[停止内核] 文件锁释放成功");
            log::info!(target: "app", "released core lock file");
        } else {
            println!("[停止内核] 没有文件锁需要释放");
        }

        *running = false;
        println!("[停止内核] 内核停止完成");
        Ok(())
    }

    /// 停止通过sidecar启动的进程
    fn stop_sidecar_process(&self) {
        if let Some(process) = handle::Handle::global().take_core_process() {
            println!("[停止sidecar] 发现sidecar进程，准备停止");
            log::info!(target: "app", "stopping core process in sidecar mode");

            // 尝试获取进程ID
            let pid = process.pid();
            println!("[停止sidecar] 进程PID: {}", pid);

            // 尝试终止进程
            if let Err(e) = process.kill() {
                println!("[停止sidecar] 终止sidecar进程失败: {}", e);
                log::warn!(target: "app", "failed to kill core process: {}", e);
            } else {
                println!("[停止sidecar] sidecar进程已成功终止");
                log::info!(target: "app", "core process stopped successfully");
            }
        } else {
            println!("[停止sidecar] 没有找到sidecar进程");
        }
    }

    /// 启动核心
    pub async fn start_core(&self) -> Result<()> {
        let mut running = self.running.lock().await;
        if *running {
            log::info!("core is running");
            return Ok(());
        }

        let config_path = Config::generate_file(ConfigType::Run)?;

        // 先检查服务状态
        let service_available = service::check_service().await.is_ok();
        
        if service_available {
            log::info!(target: "app", "try to run core in service mode");
            match service::run_core_by_service(&config_path).await {
                Ok(_) => {
                    log::info!(target: "app", "core started successfully in service mode");
                }
                Err(err) => {
                    // 服务启动失败，直接尝试sidecar模式，不再尝试重装服务
                    log::warn!(target: "app", "failed to start core in service mode: {}", err);
                    log::info!(target: "app", "trying to run core in sidecar mode");
                    self.run_core_by_sidecar(&config_path).await?;
                }
            }
        } else {
            // 服务不可用，直接使用sidecar模式
            log::info!(target: "app", "service not available, running core in sidecar mode");
            self.run_core_by_sidecar(&config_path).await?;
        }

        // 流量订阅
        #[cfg(target_os = "macos")]
        log_err!(Tray::global().subscribe_traffic().await);

        *running = true;

        Ok(())
    }

    /// 通过sidecar启动内核
    async fn run_core_by_sidecar(&self, config_path: &PathBuf) -> Result<()> {
        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("verge-mihomo".into());

        log::info!(target: "app", "starting core {} in sidecar mode", clash_core);
        println!("[sidecar启动] 开始以sidecar模式启动内核: {}", clash_core);

        // 检查系统中是否存在同名进程
        if let Ok(pids) = self.check_existing_processes(&clash_core).await {
            if !pids.is_empty() {
                println!("[sidecar启动] 警告：系统中已存在同名进程");
                // 尝试检查端口占用
                if let Ok(config_content) = std::fs::read_to_string(config_path) {
                    if let Ok(config) = serde_yaml::from_str::<serde_yaml::Value>(&config_content) {
                        // 获取配置中定义的端口
                        let mixed_port = config
                            .get("mixed-port")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(7890);
                        let http_port = config.get("port").and_then(|v| v.as_u64()).unwrap_or(7890);

                        println!(
                            "[sidecar启动] 检查端口占用: HTTP端口={}, 混合端口={}",
                            http_port, mixed_port
                        );

                        // 检查端口是否被占用
                        if self.is_port_in_use(mixed_port as u16).await
                            || self.is_port_in_use(http_port as u16).await
                        {
                            println!("[sidecar启动] 端口已被占用，尝试终止已存在的进程");

                            // 尝试终止已存在的进程
                            for pid in pids {
                                println!("[sidecar启动] 尝试终止进程 PID: {}", pid);
                                self.terminate_process(pid).await;
                            }

                            // 等待短暂时间让资源释放
                            println!("[sidecar启动] 等待500ms让资源释放");
                            sleep(Duration::from_millis(500)).await;
                        }
                    }
                }
            }
        } else {
            println!("[sidecar启动] 无法检查系统进程，继续尝试启动");
        }

        // 创建锁文件路径
        let lock_file = dirs::app_home_dir()?.join(format!("{}.lock", clash_core));
        println!("[sidecar启动] 锁文件路径: {:?}", lock_file);

        // 尝试获取文件锁
        println!("[sidecar启动] 尝试获取文件锁");
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&lock_file)?;

        match file.try_lock_exclusive() {
            Ok(_) => {
                // 成功获取锁，说明没有其他实例运行
                println!("[sidecar启动] 成功获取文件锁，没有检测到其他运行的实例");
                log::info!(target: "app", "acquired lock for core process");

                // 保存锁对象到全局，防止被Drop
                handle::Handle::global().set_core_lock(file);
            }
            Err(err) => {
                // 无法获取锁，说明已有实例运行
                println!("[sidecar启动] 无法获取文件锁，检测到其他实例可能正在运行");
                println!("[sidecar启动] 错误信息: {:?}", err);
                log::warn!(target: "app", "another core process appears to be running");

                // 尝试强制获取锁（可能会导致其他进程崩溃）
                println!("[sidecar启动] 尝试强制删除并重新创建锁文件");
                std::fs::remove_file(&lock_file)?;
                let file = std::fs::OpenOptions::new()
                    .write(true)
                    .create(true)
                    .open(&lock_file)?;

                println!("[sidecar启动] 尝试强制获取锁");
                match file.lock_exclusive() {
                    Ok(_) => println!("[sidecar启动] 成功强制获取锁"),
                    Err(e) => println!("[sidecar启动] 强制获取锁失败: {:?}", e),
                }
                file.lock_exclusive()?;

                // 保存新锁
                handle::Handle::global().set_core_lock(file);

                // 等待可能的其他进程退出
                println!("[sidecar启动] 等待500ms，让可能的其他进程退出");
                sleep(Duration::from_millis(500)).await;
            }
        }

        let app_handle = handle::Handle::global()
            .app_handle()
            .ok_or(anyhow::anyhow!("failed to get app handle"))?;

        // 获取配置目录
        let config_dir = dirs::app_home_dir()?;
        let config_path_str = dirs::path_to_str(config_path)?;

        // 启动核心进程并转入后台运行
        println!("[sidecar启动] 开始启动核心进程");
        let (_, child) = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-d", dirs::path_to_str(&config_dir)?, "-f", config_path_str])
            .spawn()?;

        // 保存进程ID以便后续管理
        println!("[sidecar启动] 核心进程启动成功，PID: {:?}", child.pid());
        handle::Handle::global().set_core_process(child);

        // 等待短暂时间确保启动成功
        sleep(Duration::from_millis(300)).await;

        println!("[sidecar启动] 内核启动完成");
        log::info!(target: "app", "core started in sidecar mode");
        Ok(())
    }

    /// 重启内核
    pub async fn restart_core(&self) -> Result<()> {
        // 重新启动app
        log::info!(target: "app", "restarting core");
        self.stop_core().await?;
        self.start_core().await?;
        log::info!(target: "app", "core restarted successfully");
        Ok(())
    }

    /// 强制重新安装服务（供UI调用，用户主动修复服务）
    pub async fn repair_service(&self) -> Result<()> {
        log::info!(target: "app", "user requested service repair");
        
        // 调用强制重装服务
        service::force_reinstall_service().await?;
        
        // 重启核心
        self.restart_core().await?;
        
        Ok(())
    }

    /// 使用默认配置
    pub async fn use_default_config(&self, msg_type: &str, msg_content: &str) -> Result<()> {
        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        *Config::runtime().draft() = IRuntime {
            config: Some(Config::clash().latest().0.clone()),
            exists_keys: vec![],
            chain_logs: Default::default(),
        };
        help::save_yaml(
            &runtime_path,
            &Config::clash().latest().0,
            Some("# Clash Verge Runtime"),
        )?;
        handle::Handle::notice_message(msg_type, msg_content);
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
        const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

        if !CLASH_CORES.contains(&clash_core.as_str()) {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::info!(target: "app", "change core to `{clash_core}`");

        // 1. 先更新内核配置（但不应用）
        Config::verge().draft().clash_core = Some(clash_core);

        // 2. 使用新内核验证配置
        println!("[切换内核] 使用新内核验证配置");
        match self.validate_config().await {
            Ok((true, _)) => {
                println!("[切换内核] 配置验证通过，开始切换内核");
                // 3. 验证通过后，应用内核配置并重启
                Config::verge().apply();
                log_err!(Config::verge().latest().save_file());

                match self.restart_core().await {
                    Ok(_) => {
                        println!("[切换内核] 内核切换成功");
                        Config::runtime().apply();
                        Ok(())
                    }
                    Err(err) => {
                        println!("[切换内核] 内核切换失败: {}", err);
                        // 即使使用服务失败，我们也尝试使用sidecar模式启动
                        log::info!(target: "app", "trying sidecar mode after service failure");
                        self.start_core().await?;
                        Config::runtime().apply();
                        Ok(())
                    }
                }
            }
            Ok((false, error_msg)) => {
                println!("[切换内核] 配置验证失败: {}", error_msg);
                // 使用默认配置并继续切换内核
                self.use_default_config("config_validate::core_change", &error_msg)
                    .await?;
                Config::verge().apply();
                log_err!(Config::verge().latest().save_file());

                match self.restart_core().await {
                    Ok(_) => {
                        println!("[切换内核] 内核切换成功（使用默认配置）");
                        Ok(())
                    }
                    Err(err) => {
                        println!("[切换内核] 内核切换失败: {}", err);
                        // 即使使用服务失败，我们也尝试使用sidecar模式启动
                        log::info!(target: "app", "trying sidecar mode after service failure with default config");
                        self.start_core().await?;
                        Ok(())
                    }
                }
            }
            Err(err) => {
                println!("[切换内核] 验证过程发生错误: {}", err);
                Config::verge().discard();
                Err(err)
            }
        }
    }

    /// 内部验证配置文件的实现
    async fn validate_config_internal(&self, config_path: &str) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过验证
        if handle::Handle::global().is_exiting() {
            println!("[core配置验证] 应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        println!("[core配置验证] 开始验证配置文件: {}", config_path);

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("verge-mihomo".into());
        println!("[core配置验证] 使用内核: {}", clash_core);

        let app_handle = handle::Handle::global().app_handle().unwrap();
        let test_dir = dirs::app_home_dir()?.join("test");
        let test_dir = dirs::path_to_str(&test_dir)?;
        println!("[core配置验证] 测试目录: {}", test_dir);

        // 使用子进程运行clash验证配置
        println!("[core配置验证] 运行子进程验证配置");
        let output = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-t", "-d", test_dir, "-f", config_path])
            .output()
            .await?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);

        // 检查进程退出状态和错误输出
        let error_keywords = ["FATA", "fatal", "Parse config error", "level=fatal"];
        let has_error =
            !output.status.success() || error_keywords.iter().any(|&kw| stderr.contains(kw));

        println!("\n[core配置验证] -------- 验证结果 --------");
        println!("[core配置验证] 进程退出状态: {:?}", output.status);

        if !stderr.is_empty() {
            println!("[core配置验证] stderr输出:\n{}", stderr);
        }
        if !stdout.is_empty() {
            println!("[core配置验证] stdout输出:\n{}", stdout);
        }

        if has_error {
            println!("[core配置验证] 发现错误，开始处理错误信息");
            let error_msg = if !stdout.is_empty() {
                stdout.to_string()
            } else if !stderr.is_empty() {
                stderr.to_string()
            } else if let Some(code) = output.status.code() {
                format!("验证进程异常退出，退出码: {}", code)
            } else {
                "验证进程被终止".to_string()
            };

            println!("[core配置验证] -------- 验证结束 --------\n");
            Ok((false, error_msg)) // 返回错误消息给调用者处理
        } else {
            println!("[core配置验证] 验证成功");
            println!("[core配置验证] -------- 验证结束 --------\n");
            Ok((true, String::new()))
        }
    }

    /// 验证运行时配置
    pub async fn validate_config(&self) -> Result<(bool, String)> {
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
            println!("[core配置验证] 应用正在退出，跳过验证");
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
            println!(
                "[core配置验证] 检测到Merge文件，仅进行语法检查: {}",
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
                    log::warn!(target: "app", "无法确定文件类型: {}, 错误: {}", config_path, err);
                    return self.validate_config_internal(config_path).await;
                }
            }
        };

        if is_script {
            log::info!(target: "app", "检测到脚本文件，使用JavaScript验证: {}", config_path);
            return self.validate_script_file(config_path).await;
        }

        // 对YAML配置文件使用Clash内核验证
        log::info!(target: "app", "使用Clash内核验证配置文件: {}", config_path);
        self.validate_config_internal(config_path).await
    }

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
                log::warn!(target: "app", "无法读取文件以检测类型: {}, 错误: {}", path, err);
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
        log::debug!(target: "app", "无法确定文件类型，默认当作YAML处理: {}", path);
        Ok(false)
    }

    /// 验证脚本文件语法
    async fn validate_script_file(&self, path: &str) -> Result<(bool, String)> {
        // 读取脚本内容
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read script file: {}", err);
                log::warn!(target: "app", "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                return Ok((false, error_msg));
            }
        };

        log::debug!(target: "app", "验证脚本文件: {}", path);

        // 使用boa引擎进行基本语法检查
        use boa_engine::{Context, Source};

        let mut context = Context::default();
        let result = context.eval(Source::from_bytes(&content));

        match result {
            Ok(_) => {
                log::debug!(target: "app", "脚本语法验证通过: {}", path);

                // 检查脚本是否包含main函数
                if !content.contains("function main")
                    && !content.contains("const main")
                    && !content.contains("let main")
                {
                    let error_msg = "Script must contain a main function";
                    log::warn!(target: "app", "脚本缺少main函数: {}", path);
                    //handle::Handle::notice_message("config_validate::script_missing_main", error_msg);
                    return Ok((false, error_msg.to_string()));
                }

                Ok((true, String::new()))
            }
            Err(err) => {
                let error_msg = format!("Script syntax error: {}", err);
                log::warn!(target: "app", "脚本语法错误: {}", err);
                //handle::Handle::notice_message("config_validate::script_syntax_error", &error_msg);
                Ok((false, error_msg))
            }
        }
    }

    /// 更新proxies等配置
    pub async fn update_config(&self) -> Result<(bool, String)> {
        // 检查程序是否正在退出，如果是则跳过完整验证流程
        if handle::Handle::global().is_exiting() {
            println!("[core配置更新] 应用正在退出，跳过验证");
            return Ok((true, String::new()));
        }

        println!("[core配置更新] 开始更新配置");

        // 1. 先生成新的配置内容
        println!("[core配置更新] 生成新的配置内容");
        Config::generate().await?;

        // 2. 生成临时文件并进行验证
        println!("[core配置更新] 生成临时配置文件用于验证");
        let temp_config = Config::generate_file(ConfigType::Check)?;
        let temp_config = dirs::path_to_str(&temp_config)?;
        println!("[core配置更新] 临时配置文件路径: {}", temp_config);

        // 3. 验证配置
        match self.validate_config().await {
            Ok((true, _)) => {
                println!("[core配置更新] 配置验证通过");
                // 4. 验证通过后，生成正式的运行时配置
                println!("[core配置更新] 生成运行时配置");
                let run_path = Config::generate_file(ConfigType::Run)?;
                let run_path = dirs::path_to_str(&run_path)?;

                // 5. 应用新配置
                println!("[core配置更新] 应用新配置");
                
                // 检查当前运行模式
                let running_mode = self.get_running_mode().await;
                
                // 使用指数退避策略进行重试
                let mut retry_count = 0;
                let max_retries = 3;
                
                loop {
                    // 仅在服务模式下确保服务在运行
                    match running_mode {
                        RunningMode::Service => {
                            println!("[core配置更新] 服务模式下检查服务状态");
                            self.ensure_running_core().await;
                        },
                        _ => {
                            println!("[core配置更新] 非服务模式，跳过服务状态检查");
                        }
                    }

                    match MihomoManager::global().put_configs_force(run_path).await {
                        Ok(_) => {
                            println!("[core配置更新] 配置应用成功");
                            Config::runtime().apply();
                            return Ok((true, String::new()));
                        }
                        Err(err) => {
                            retry_count += 1;
                            if retry_count < max_retries {
                                // 使用指数退避策略计算下一次重试间隔
                                let wait_time = 200 * (2_u64.pow(retry_count as u32 - 1));
                                println!("[core配置更新] 第{}次重试应用配置，等待{}ms", retry_count, wait_time);
                                log::info!(target: "app", "配置应用失败: {}，将在{}ms后重试", err, wait_time);
                                sleep(Duration::from_millis(wait_time)).await;
                            } else {
                                println!("[core配置更新] 已重试{}次，配置应用失败: {}", max_retries, err);
                                Config::runtime().discard();
                                return Ok((false, err.to_string()));
                            }
                        }
                    }
                }
            }
            Ok((false, error_msg)) => {
                println!("[core配置更新] 配置验证失败: {}", error_msg);
                Config::runtime().discard();
                Ok((false, error_msg))
            }
            Err(e) => {
                println!("[core配置更新] 验证过程发生错误: {}", e);
                Config::runtime().discard();
                Err(e)
            }
        }
    }

    /// 只进行文件语法检查，不进行完整验证
    async fn validate_file_syntax(&self, config_path: &str) -> Result<(bool, String)> {
        println!("[core配置语法检查] 开始检查文件: {}", config_path);

        // 读取文件内容
        let content = match std::fs::read_to_string(config_path) {
            Ok(content) => content,
            Err(err) => {
                let error_msg = format!("Failed to read file: {}", err);
                println!("[core配置语法检查] 无法读取文件: {}", error_msg);
                return Ok((false, error_msg));
            }
        };

        // 对YAML文件尝试解析，只检查语法正确性
        println!("[core配置语法检查] 进行YAML语法检查");
        match serde_yaml::from_str::<serde_yaml::Value>(&content) {
            Ok(_) => {
                println!("[core配置语法检查] YAML语法检查通过");
                Ok((true, String::new()))
            }
            Err(err) => {
                // 使用标准化的前缀，以便错误处理函数能正确识别
                let error_msg = format!("YAML syntax error: {}", err);
                println!("[core配置语法检查] YAML语法错误: {}", error_msg);
                Ok((false, error_msg))
            }
        }
    }

    /// 获取当前内核运行模式
    pub async fn get_running_mode(&self) -> RunningMode {
        let running = self.running.lock().await;
        if !*running {
            return RunningMode::NotRunning;
        }

        // 检查服务状态
        match service::check_service().await {
            Ok(_) => {
                // 检查服务是否实际运行核心
                match service::is_service_running().await {
                    Ok(true) => RunningMode::Service,
                    _ => {
                        // 服务存在但可能没有运行，检查是否有sidecar进程
                        if handle::Handle::global().has_core_process() {
                            // 检查是否持有文件锁，确保是由我们启动的进程
                            if handle::Handle::global().has_core_lock() {
                                RunningMode::Sidecar
                            } else {
                                // 有进程但没有文件锁，可能是外部启动的进程
                                log::warn!(target: "app", "core process exists but no lock file");
                                RunningMode::Sidecar // 仍返回Sidecar模式，但记录了警告
                            }
                        } else {
                            RunningMode::NotRunning
                        }
                    }
                }
            }
            Err(_) => {
                // 服务不可用，检查是否有sidecar进程
                if handle::Handle::global().has_core_process() {
                    // 检查是否持有文件锁，确保是由我们启动的进程
                    if handle::Handle::global().has_core_lock() {
                        RunningMode::Sidecar
                    } else {
                        // 有进程但没有文件锁，可能是外部启动的进程
                        log::warn!(target: "app", "core process exists but no lock file");
                        RunningMode::Sidecar // 仍返回Sidecar模式，但记录了警告
                    }
                } else {
                    RunningMode::NotRunning
                }
            }
        }
    }

    /// 检查系统中是否存在同名进程
    async fn check_existing_processes(&self, process_name: &str) -> Result<Vec<u32>> {
        println!("[进程检查] 检查系统中是否存在进程: {}", process_name);
        
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            
            println!("[进程检查] Windows系统，使用tasklist命令");
            let output = Command::new("tasklist")
                .args(["/FO", "CSV", "/NH"])
                .output()?;
                
            let output = String::from_utf8_lossy(&output.stdout);

            let pids: Vec<u32> = output
                .lines()
                .filter(|line| line.contains(process_name))
                .filter_map(|line| {
                    println!("[进程检查] 发现匹配行: {}", line);
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        let pid_str = parts[1].trim_matches('"');
                        pid_str.parse::<u32>().ok().map(|pid| {
                            println!("[进程检查] 发现进程 PID: {}", pid);
                            pid
                        })
                    } else {
                        None
                    }
                })
                .collect();
            
            println!("[进程检查] 共发现 {} 个相关进程", pids.len());
            Ok(pids)
        }
        
        #[cfg(target_os = "linux")]
        {
            use std::process::Command;
            
            println!("[进程检查] Linux系统，使用pgrep命令");
            let output = Command::new("pgrep")
                .arg("-f")
                .arg(process_name)
                .output()?;
                
            let output = String::from_utf8_lossy(&output.stdout);

            let pids: Vec<u32> = output
                .lines()
                .filter_map(|line| {
                    line.trim().parse::<u32>().ok().map(|pid| {
                        println!("[进程检查] 发现进程 PID: {}", pid);
                        pid
                    })
                })
                .collect();
            
            println!("[进程检查] 共发现 {} 个相关进程", pids.len());
            Ok(pids)
        }
        
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            
            println!("[进程检查] macOS系统，使用ps命令");
            let output = Command::new("ps")
                .args(["-ax", "-o", "pid,command"])
                .output()?;
                
            let output = String::from_utf8_lossy(&output.stdout);

            let pids: Vec<u32> = output
                .lines()
                .filter(|line| line.contains(process_name))
                .filter_map(|line| {
                    println!("[进程检查] 发现匹配行: {}", line);
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if !parts.is_empty() {
                        parts[0].parse::<u32>().ok().map(|pid| {
                            println!("[进程检查] 发现进程 PID: {}", pid);
                            pid
                        })
                    } else {
                        None
                    }
                })
                .collect();
            
            println!("[进程检查] 共发现 {} 个相关进程", pids.len());
            Ok(pids)
        }
    }

    /// 检查端口是否被占用
    async fn is_port_in_use(&self, port: u16) -> bool {
        println!("[端口检查] 检查端口 {} 是否被占用", port);

       use tokio::net::TcpSocket;

        match TcpSocket::new_v4() {
            Ok(socket) => {
                let addr = format!("127.0.0.1:{}", port).parse().unwrap();
                match socket.bind(addr) {
                    Ok(_) => {
                        // 如果能绑定成功，说明端口未被占用
                        println!("[端口检查] 端口 {} 未被占用", port);
                        false
                    }
                    Err(_) => {
                        // 绑定失败，端口已被占用
                        println!("[端口检查] 端口 {} 已被占用", port);
                        true
                    }
                }
            }
            Err(err) => {
                // 创建socket失败，保守返回端口被占用
                println!("[端口检查] 创建Socket失败: {:?}, 假设端口已被占用", err);
                true
            }
        }
    }

    /// 终止进程
    async fn terminate_process(&self, pid: u32) {
        println!("[进程终止] 尝试终止进程 PID: {}", pid);

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let output = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();

            match output {
                Ok(output) => {
                    if output.status.success() {
                        println!("[进程终止] 成功终止进程 PID: {}", pid);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        println!("[进程终止] 终止进程失败: {}", stderr);
                    }
                }
                Err(err) => {
                    println!("[进程终止] 执行终止命令失败: {:?}", err);
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            use std::process::Command;
            let output = Command::new("kill").args(["-9", &pid.to_string()]).output();

            match output {
                Ok(output) => {
                    if output.status.success() {
                        println!("[进程终止] 成功终止进程 PID: {}", pid);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        println!("[进程终止] 终止进程失败: {}", stderr);
                    }
                }
                Err(err) => {
                    println!("[进程终止] 执行终止命令失败: {:?}", err);
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let output = Command::new("kill").args(["-9", &pid.to_string()]).output();

            match output {
                Ok(output) => {
                    if output.status.success() {
                        println!("[进程终止] 成功终止进程 PID: {}", pid);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        println!("[进程终止] 终止进程失败: {}", stderr);
                    }
                }
                Err(err) => {
                    println!("[进程终止] 执行终止命令失败: {:?}", err);
                }
            }
        }
    }
    /// 确保 Mihomo 和 Verge service 都在运行
    pub async fn ensure_running_core(&self) {
        // 添加时间间隔检查，避免频繁执行
        let min_check_interval = Duration::from_secs(20); // 最小检查间隔为20秒
        
        let should_check = {
            let mut last_check = self.last_check_time.lock().await;
            let now = std::time::Instant::now();
            
            match *last_check {
                Some(time) if now.duration_since(time) < min_check_interval => {
                    // 如果距离上次检查时间不足30秒，跳过本次检查
                    false
                },
                _ => {
                    // 更新最后检查时间
                    *last_check = Some(now);
                    true
                }
            }
        };
        
        if !should_check {
            return;
        }
        
        // 检查当前运行模式，只在服务模式下执行完整的检查
        match self.get_running_mode().await {
            RunningMode::Service => {
                println!("[确保核心运行] 服务模式下检查核心状态");
                
                // 检查Mihomo是否运行
                if MihomoManager::global().is_mihomo_running().await.is_err() {
                    println!("[确保核心运行] Mihomo未运行，尝试重启");
                    log_err!(self.restart_core().await);
                    return; // 已重启，无需继续检查
                }
                
                // 检查服务是否运行
                match is_service_running().await {
                    Ok(false) => {
                        println!("[确保核心运行] 服务未运行，尝试重启");
                        log_err!(self.restart_core().await);
                    },
                    Ok(true) => {
                        // 服务运行中，再次确认Mihomo状态
                        if MihomoManager::global().is_mihomo_running().await.is_err() {
                            println!("[确保核心运行] 服务运行但Mihomo未响应，尝试重启");
                            log_err!(self.restart_core().await);
                        } else {
                            println!("[确保核心运行] 服务和Mihomo都正常运行");
                        }
                    },
                    Err(err) => {
                        println!("[确保核心运行] 检查服务状态失败: {:?}", err);
                    }
                }
            },
            RunningMode::Sidecar => {
                println!("[确保核心运行] Sidecar模式下仅检查Mihomo状态");
                // 在Sidecar模式下，只检查Mihomo是否运行
                if MihomoManager::global().is_mihomo_running().await.is_err() {
                    println!("[确保核心运行] Mihomo未运行，尝试重启");
                    log_err!(self.restart_core().await);
                }
            },
            RunningMode::NotRunning => {
                println!("[确保核心运行] 核心未运行，尝试启动");
                log_err!(self.start_core().await);
            }
        }
    }
}

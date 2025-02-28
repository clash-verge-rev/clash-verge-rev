use crate::config::*;
use crate::core::{clash_api, handle, service};
#[cfg(target_os = "macos")]
use crate::core::tray::Tray;
use crate::log_err;
use crate::utils::{dirs, help};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use serde_yaml::Mapping;
use std::{sync::Arc, time::Duration};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use tokio::time::sleep;

#[derive(Debug)]
pub struct CoreManager {
    running: Arc<Mutex<bool>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();
        CORE_MANAGER.get_or_init(|| CoreManager {
            running: Arc::new(Mutex::new(false)),
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
            log::debug!("core is not running");
            return Ok(());
        }

        // 关闭tun模式
        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());
        log::debug!(target: "app", "disable tun mode");
        log_err!(clash_api::patch_configs(&disable).await);

        // 服务模式
        if service::check_service().await.is_ok() {
            log::info!(target: "app", "stop the core by service");
            service::stop_core_by_service().await?;
        }
        *running = false;
        Ok(())
    }

    /// 启动核心
    pub async fn start_core(&self) -> Result<()> {
        let mut running = self.running.lock().await;
        if *running {
            log::info!("core is running");
            return Ok(());
        }

        let config_path = Config::generate_file(ConfigType::Run)?;

        // 服务模式
        if service::check_service().await.is_ok() {
            log::info!(target: "app", "try to run core in service mode");
            service::run_core_by_service(&config_path).await?;
        }
        // 流量订阅
        #[cfg(target_os = "macos")]
        log_err!(Tray::global().subscribe_traffic().await);

        *running = true;

        Ok(())
    }

    /// 重启内核
    pub async fn restart_core(&self) -> Result<()> {
        // 重新启动app
        self.stop_core().await?;
        self.start_core().await?;
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
                        Config::verge().discard();
                        Config::runtime().discard();
                        Err(err)
                    }
                }
            }
            Ok((false, error_msg)) => {
                println!("[切换内核] 配置验证失败: {}", error_msg);
                // 使用默认配置并继续切换内核
                self.use_default_config("config_validate::core_change", &error_msg).await?;
                Config::verge().apply();
                log_err!(Config::verge().latest().save_file());
                
                match self.restart_core().await {
                    Ok(_) => {
                        println!("[切换内核] 内核切换成功（使用默认配置）");
                        Ok(())
                    }
                    Err(err) => {
                        println!("[切换内核] 内核切换失败: {}", err);
                        Config::verge().discard();
                        Err(err)
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
        let has_error = !output.status.success() || error_keywords.iter().any(|&kw| stderr.contains(kw));
        
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
            Ok((false, error_msg))  // 返回错误消息给调用者处理
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
    pub async fn validate_config_file(&self, config_path: &str, is_merge_file: Option<bool>) -> Result<(bool, String)> {
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
            println!("[core配置验证] 检测到Merge文件，仅进行语法检查: {}", config_path);
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
                return Err(anyhow::anyhow!("Failed to read file to detect type: {}", err));
            }
        };
        
        // 3. 检查是否存在明显的YAML特征
        let has_yaml_features = content.contains(": ") || 
                               content.contains("#") || 
                               content.contains("---") ||
                               content.lines().any(|line| line.trim().starts_with("- "));
                               
        // 4. 检查是否存在明显的JS特征
        let has_js_features = content.contains("function ") || 
                             content.contains("const ") || 
                             content.contains("let ") ||
                             content.contains("var ") ||
                             content.contains("//") ||
                             content.contains("/*") ||
                             content.contains("*/") ||
                             content.contains("export ") ||
                             content.contains("import ");
        
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
            if content.contains("function main") || 
               content.contains("module.exports") ||
               content.contains("export default") {
                return Ok(true);
            }
            
            // 检查冒号后是否有空格（YAML的典型特征）
            let yaml_pattern_count = content.lines()
                .filter(|line| line.contains(": "))
                .count();
                
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
                if !content.contains("function main") && !content.contains("const main") && !content.contains("let main") {
                    let error_msg = "Script must contain a main function";
                    log::warn!(target: "app", "脚本缺少main函数: {}", path);
                    //handle::Handle::notice_message("config_validate::script_missing_main", error_msg);
                    return Ok((false, error_msg.to_string()));
                }
                
                Ok((true, String::new()))
            },
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
                for i in 0..3 {
                    match clash_api::put_configs(run_path).await {
                        Ok(_) => {
                            println!("[core配置更新] 配置应用成功");
                            Config::runtime().apply();
                            return Ok((true, String::new()));
                        }
                        Err(err) => {
                            if i < 2 {
                                println!("[core配置更新] 第{}次重试应用配置", i + 1);
                                log::info!(target: "app", "{err}");
                                sleep(Duration::from_millis(100)).await;
                            } else {
                                println!("[core配置更新] 配置应用失败: {}", err);
                                Config::runtime().discard();
                                return Ok((false, err.to_string()));
                            }
                        }
                    }
                }
                Ok((true, String::new()))
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
            },
            Err(err) => {
                // 使用标准化的前缀，以便错误处理函数能正确识别
                let error_msg = format!("YAML syntax error: {}", err);
                println!("[core配置语法检查] YAML语法错误: {}", error_msg);
                Ok((false, error_msg))
            }
        }
    }
}
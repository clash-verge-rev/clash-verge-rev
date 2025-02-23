use crate::config::*;
use crate::core::{clash_api, handle, service};
use crate::core::tray::Tray;
use crate::log_err;
use crate::utils::dirs;
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

    /// 检查订阅是否正确
    pub async fn check_config(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("verge-mihomo".into());

        let test_dir = dirs::app_home_dir()?.join("test");
        let test_dir = dirs::path_to_str(&test_dir)?;
        let app_handle = handle::Handle::global().app_handle().unwrap();

        let _ = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-t", "-d", test_dir, "-f", config_path])
            .output()
            .await?;

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

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
        const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

        if !CLASH_CORES.contains(&clash_core.as_str()) {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::info!(target: "app", "change core to `{clash_core}`");

        Config::verge().draft().clash_core = Some(clash_core);

        // 更新订阅
        Config::generate().await?;

        self.check_config().await?;

        match self.restart_core().await {
            Ok(_) => {
                Config::verge().apply();
                Config::runtime().apply();
                log_err!(Config::verge().latest().save_file());
                Ok(())
            }
            Err(err) => {
                Config::verge().discard();
                Config::runtime().discard();
                Err(err)
            }
        }
    }

    /// 使用子进程验证配置
    pub async fn validate_config(&self) -> Result<(bool, String)> {
        println!("[core配置验证] 开始验证配置");
        
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;
        println!("[core配置验证] 配置文件路径: {}", config_path);

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
        
        println!("[core配置验证] 退出状态: {:?}", output.status);
        if !stderr.is_empty() {
            println!("[core配置验证] 错误输出: {}", stderr);
        }
        if !stdout.is_empty() {
            println!("[core配置验证] 标准输出: {}", stdout);
        }

        if has_error {
            let error_msg = if stderr.is_empty() {
                if let Some(code) = output.status.code() {
                    handle::Handle::notice_message("config_validate::error", &code.to_string());
                    String::new()
                } else {
                    handle::Handle::notice_message("config_validate::process_terminated", "");
                    String::new()
                }
            } else {
                handle::Handle::notice_message("config_validate::stderr_error", &*stderr);
                String::new()
            };
            Ok((false, error_msg))
        } else {
            handle::Handle::notice_message("config_validate::success", "");
            Ok((true, String::new()))
        }
    }

    /// 更新proxies等配置
    pub async fn update_config(&self) -> Result<()> {
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
        let (is_valid, error_msg) = match self.validate_config().await {
            Ok((valid, msg)) => (valid, msg),
            Err(e) => {
                println!("[core配置更新] 验证过程发生错误: {}", e);
                Config::runtime().discard(); // 验证失败时丢弃新配置
                return Err(e);
            }
        };

        if !is_valid {
            println!("[core配置更新] 配置验证未通过，保持当前配置不变");
            Config::runtime().discard(); // 验证失败时丢弃新配置
            return Err(anyhow::anyhow!(error_msg));
        }

        // 4. 验证通过后，生成正式的运行时配置
        println!("[core配置更新] 验证通过，生成运行时配置");
        let run_path = Config::generate_file(ConfigType::Run)?;
        let run_path = dirs::path_to_str(&run_path)?;

        // 5. 应用新配置
        println!("[core配置更新] 应用新配置");
        for i in 0..10 {
            match clash_api::put_configs(run_path).await {
                Ok(_) => {
                    println!("[core配置更新] 配置应用成功");
                    Config::runtime().apply(); // 应用成功时保存新配置
                    break;
                }
                Err(err) => {
                    if i < 9 {
                        println!("[core配置更新] 第{}次重试应用配置", i + 1);
                        log::info!(target: "app", "{err}");
                    } else {
                        println!("[core配置更新] 配置应用失败: {}", err);
                        Config::runtime().discard(); // 应用失败时丢弃新配置
                        return Err(err.into());
                    }
                }
            }
            sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }
}

use crate::config::*;
use crate::core::{clash_api, handle, logger::Logger, service};
use crate::log_err;
use crate::utils::dirs;
use anyhow::{bail, Context, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde_yaml::Mapping;
use std::{fs, io::Write, sync::Arc, time::Duration};
use sysinfo::{ProcessRefreshKind, RefreshKind, System};
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use tokio::time::sleep;

#[derive(Debug)]
pub struct CoreManager {
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    sidecar: Arc<Mutex<Option<CommandChild>>>,
    #[allow(unused)]
    use_service_mode: Arc<Mutex<bool>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();

        CORE_MANAGER.get_or_init(|| CoreManager {
            app_handle: Arc::new(Mutex::new(None)),
            sidecar: Arc::new(Mutex::new(None)),
            use_service_mode: Arc::new(Mutex::new(false)),
        })
    }

    pub fn init(&self, app_handle: &AppHandle) -> Result<()> {
        *self.app_handle.lock() = Some(app_handle.clone());
        tauri::async_runtime::spawn(async {
            log::trace!("run core start");
            // 启动clash
            log_err!(Self::global().run_core().await);
            log::trace!("run core end");
        });

        Ok(())
    }

    /// 检查订阅是否正确
    pub async fn check_config(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let mut clash_core = clash_core.unwrap_or("verge-mihomo".into());

        // compatibility
        if clash_core.contains("clash") {
            clash_core = "verge-mihomo".to_string();
            Config::verge().draft().patch_config(IVerge {
                clash_core: Some("verge-mihomo".to_string()),
                ..IVerge::default()
            });
            Config::verge().apply();
            match Config::verge().data().save_file() {
                Ok(_) => handle::Handle::refresh_verge(),
                Err(err) => log::error!(target: "app", "{err}"),
            }
        }

        let test_dir = dirs::app_home_dir()?.join("test");
        let test_dir = dirs::path_to_str(&test_dir)?;
        let app_handle_option = {
            let lock = self.app_handle.lock();
            lock.as_ref().cloned()
        };

        if let Some(app_handle) = app_handle_option {
            let output = app_handle
                .shell()
                .sidecar(clash_core)?
                .args(["-t", "-d", test_dir, "-f", config_path])
                .output()
                .await?;

            if !output.status.success() {
                let stdout = String::from_utf8(output.stdout).unwrap_or_default();
                let error = clash_api::parse_check_output(stdout.clone());
                let error = match !error.is_empty() {
                    true => error,
                    false => stdout.clone(),
                };
                Logger::global().set_log(stdout.clone());
                bail!("{error}");
            }
        }

        Ok(())
    }

    /// 启动核心
    pub async fn run_core(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Run)?;

        // 关闭tun模式
        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());
        log::debug!(target: "app", "disable tun mode");
        let _ = clash_api::patch_configs(&disable).await;

        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            log_err!(service::stop_core_by_service().await);
        } else {
            let system = System::new_with_specifics(
                RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
            );
            let procs = system.processes_by_name("verge-mihomo");

            for proc in procs {
                log::debug!(target: "app", "kill all clash process");
                proc.kill();
            }
        }

        // 服务模式
        let enable = { Config::verge().latest().enable_service_mode };
        let enable = enable.unwrap_or(false);

        *self.use_service_mode.lock() = enable;

        if enable {
            // 服务模式启动失败就直接运行sidecar
            log::debug!(target: "app", "try to run core in service mode");

            let res = async {
                service::check_service().await?;
                service::run_core_by_service(&config_path).await
            }
            .await;
            match res {
                Ok(_) => return Ok(()),
                Err(err) => {
                    // 修改这个值，免得stop出错
                    *self.use_service_mode.lock() = false;
                    log::error!(target: "app", "{err}");
                }
            }
        }

        let app_dir = dirs::app_home_dir()?;
        let app_dir = dirs::path_to_str(&app_dir)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let mut clash_core = clash_core.unwrap_or("verge-mihomo".into());

        // compatibility
        if clash_core.contains("clash") {
            clash_core = "verge-mihomo".to_string();
            Config::verge().draft().patch_config(IVerge {
                clash_core: Some("verge-mihomo".to_string()),
                ..IVerge::default()
            });
            Config::verge().apply();
            match Config::verge().data().save_file() {
                Ok(_) => handle::Handle::refresh_verge(),
                Err(err) => log::error!(target: "app", "{err}"),
            }
        }

        let config_path = dirs::path_to_str(&config_path)?;

        let args = vec!["-d", app_dir, "-f", config_path];

        let app_handle = self.app_handle.lock();

        if let Some(app_handle) = app_handle.as_ref() {
            let cmd = app_handle.shell().sidecar(clash_core)?;
            let (mut rx, cmd_child) = cmd.args(args).spawn()?;

            // 将pid写入文件中
            crate::log_err!((|| {
                let pid = cmd_child.pid();
                let path = dirs::clash_pid_path()?;
                fs::File::create(path)
                    .context("failed to create the pid file")?
                    .write(format!("{pid}").as_bytes())
                    .context("failed to write pid to the file")?;
                <Result<()>>::Ok(())
            })());

            let mut sidecar = self.sidecar.lock();
            *sidecar = Some(cmd_child);
            drop(sidecar);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8(line).unwrap_or_default();
                            log::info!(target: "app", "[mihomo]: {line}");
                            Logger::global().set_log(line);
                        }
                        CommandEvent::Stderr(err) => {
                            let err = String::from_utf8(err).unwrap_or_default();
                            log::error!(target: "app", "[mihomo]: {err}");
                            Logger::global().set_log(err);
                        }
                        CommandEvent::Error(err) => {
                            log::error!(target: "app", "[mihomo]: {err}");
                            Logger::global().set_log(err);
                        }
                        CommandEvent::Terminated(_) => {
                            log::info!(target: "app", "mihomo core terminated");
                            let _ = CoreManager::global().recover_core();
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }

        Ok(())
    }

    /// 重启内核
    pub fn recover_core(&'static self) -> Result<()> {
        // 服务模式不管
        if *self.use_service_mode.lock() {
            return Ok(());
        }

        // 清空原来的sidecar值
        let _ = self.sidecar.lock().take();

        tauri::async_runtime::spawn(async move {
            // 6秒之后再查看服务是否正常 (时间随便搞的)
            // terminated 可能是切换内核 (切换内核已经有500ms的延迟)
            sleep(Duration::from_millis(6666)).await;

            if self.sidecar.lock().is_none() {
                log::info!(target: "app", "recover clash core");

                // 重新启动app
                if let Err(err) = self.run_core().await {
                    log::error!(target: "app", "failed to recover clash core");
                    log::error!(target: "app", "{err}");

                    let _ = self.recover_core();
                }
            }
        });

        Ok(())
    }

    /// 停止核心运行
    pub async fn stop_core(&self) -> Result<()> {
        // 关闭tun模式
        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());
        log::debug!(target: "app", "disable tun mode");
        let _ = clash_api::patch_configs(&disable).await;

        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            log_err!(service::stop_core_by_service().await);
            return Ok(());
        }

        let mut sidecar = self.sidecar.lock();
        let _ = sidecar.take();

        let system = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
        );
        let procs = system.processes_by_name("verge-mihomo");
        for proc in procs {
            log::debug!(target: "app", "kill all clash process");
            proc.kill();
        }
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
        const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

        if !CLASH_CORES.contains(&clash_core.as_str()) {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::debug!(target: "app", "change core to `{clash_core}`");

        Config::verge().draft().clash_core = Some(clash_core);

        // 更新订阅
        Config::generate().await?;

        self.check_config().await?;

        // 清掉旧日志
        Logger::global().clear_log();

        match self.run_core().await {
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

    /// 更新proxies那些
    /// 如果涉及端口和外部控制则需要重启
    pub async fn update_config(&self) -> Result<()> {
        log::debug!(target: "app", "try to update clash config");
        // 更新订阅
        Config::generate().await?;

        // 检查订阅是否正常
        self.check_config().await?;

        // 更新运行时订阅
        let path = Config::generate_file(ConfigType::Run)?;
        let path = dirs::path_to_str(&path)?;

        // 发送请求 发送5次
        for i in 0..10 {
            match clash_api::put_configs(path).await {
                Ok(_) => break,
                Err(err) => {
                    if i < 9 {
                        log::info!(target: "app", "{err}");
                    } else {
                        bail!(err);
                    }
                }
            }
            sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }
}

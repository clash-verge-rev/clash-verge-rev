use super::{clash_api, logger::Logger};
use crate::log_err;
use crate::{config::*, utils::dirs};
use anyhow::{bail, Context, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::{fs, io::Write, sync::Arc, time::Duration};
use sysinfo::{Pid, PidExt, ProcessExt, System, SystemExt};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tokio::time::sleep;

#[derive(Debug)]
pub struct CoreManager {
    sidecar: Arc<Mutex<Option<CommandChild>>>,

    #[allow(unused)]
    use_service_mode: Arc<Mutex<bool>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();

        CORE_MANAGER.get_or_init(|| CoreManager {
            sidecar: Arc::new(Mutex::new(None)),
            use_service_mode: Arc::new(Mutex::new(false)),
        })
    }

    pub fn init(&self) -> Result<()> {
        // kill old clash process
        let _ = dirs::clash_pid_path()
            .and_then(|path| fs::read(path).map(|p| p.to_vec()).context(""))
            .and_then(|pid| String::from_utf8_lossy(&pid).parse().context(""))
            .map(|pid| {
                let mut system = System::new();
                system.refresh_all();
                system.process(Pid::from_u32(pid)).map(|proc| {
                    if proc.name().contains("clash") {
                        log::debug!(target: "app", "kill old clash process");
                        proc.kill();
                    }
                });
            });

        tauri::async_runtime::spawn(async {
            // 启动clash
            log_err!(Self::global().run_core().await);
        });

        Ok(())
    }

    /// 检查配置是否正确
    pub fn check_config(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("clash".into());

        let app_dir = dirs::app_home_dir()?;
        let app_dir = dirs::path_to_str(&app_dir)?;

        let output = Command::new_sidecar(clash_core)?
            .args(["-t", "-d", app_dir, "-f", config_path])
            .output()?;

        if !output.status.success() {
            let error = clash_api::parse_check_output(output.stdout.clone());
            let error = match error.len() > 0 {
                true => error,
                false => output.stdout.clone(),
            };
            Logger::global().set_log(output.stdout);
            bail!("{error}");
        }

        Ok(())
    }

    /// 启动核心
    pub async fn run_core(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Run)?;

        #[allow(unused_mut)]
        let mut should_kill = match self.sidecar.lock().take() {
            Some(child) => {
                log::debug!(target: "app", "stop the core by sidecar");
                let _ = child.kill();
                true
            }
            None => false,
        };

        #[cfg(target_os = "windows")]
        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            log_err!(super::win_service::stop_core_by_service().await);
            should_kill = true;
        }

        // 这里得等一会儿
        if should_kill {
            sleep(Duration::from_millis(500)).await;
        }

        #[cfg(target_os = "windows")]
        {
            use super::win_service;

            // 服务模式
            let enable = { Config::verge().latest().enable_service_mode.clone() };
            let enable = enable.unwrap_or(false);

            *self.use_service_mode.lock() = enable;

            if enable {
                // 服务模式启动失败就直接运行sidecar
                log::debug!(target: "app", "try to run core in service mode");

                match (|| async {
                    win_service::check_service().await?;
                    win_service::run_core_by_service(&config_path).await
                })()
                .await
                {
                    Ok(_) => return Ok(()),
                    Err(err) => {
                        // 修改这个值，免得stop出错
                        *self.use_service_mode.lock() = false;
                        log::error!(target: "app", "{err}");
                    }
                }
            }
        }

        let app_dir = dirs::app_home_dir()?;
        let app_dir = dirs::path_to_str(&app_dir)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("clash".into());
        let is_clash = clash_core == "clash";

        let config_path = dirs::path_to_str(&config_path)?;

        // fix #212
        let args = match clash_core.as_str() {
            "clash-meta" => vec!["-m", "-d", app_dir, "-f", config_path],
            _ => vec!["-d", app_dir, "-f", config_path],
        };

        let cmd = Command::new_sidecar(clash_core)?;
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
                        if is_clash {
                            let stdout = clash_api::parse_log(line.clone());
                            log::info!(target: "app", "[clash]: {stdout}");
                        } else {
                            log::info!(target: "app", "[clash]: {line}");
                        };
                        Logger::global().set_log(line);
                    }
                    CommandEvent::Stderr(err) => {
                        // let stdout = clash_api::parse_log(err.clone());
                        log::error!(target: "app", "[clash]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Error(err) => {
                        log::error!(target: "app", "[clash]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Terminated(_) => {
                        log::info!(target: "app", "clash core terminated");
                        let _ = CoreManager::global().recover_core();
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// 重启内核
    pub fn recover_core(&'static self) -> Result<()> {
        // 服务模式不管
        #[cfg(target_os = "windows")]
        if *self.use_service_mode.lock() {
            return Ok(());
        }

        // 清空原来的sidecar值
        if let Some(sidecar) = self.sidecar.lock().take() {
            let _ = sidecar.kill();
        }

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
    pub fn stop_core(&self) -> Result<()> {
        #[cfg(target_os = "windows")]
        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            tauri::async_runtime::block_on(async move {
                log_err!(super::win_service::stop_core_by_service().await);
            });
            return Ok(());
        }

        let mut sidecar = self.sidecar.lock();
        if let Some(child) = sidecar.take() {
            log::debug!(target: "app", "stop the core by sidecar");
            let _ = child.kill();
        }
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;

        if &clash_core != "clash" && &clash_core != "clash-meta" {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::debug!(target: "app", "change core to `{clash_core}`");

        Config::verge().draft().clash_core = Some(clash_core);

        // 更新配置
        Config::generate()?;

        self.check_config()?;

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

        // 更新配置
        Config::generate()?;

        // 检查配置是否正常
        self.check_config()?;

        // 更新运行时配置
        let path = Config::generate_file(ConfigType::Run)?;
        let path = dirs::path_to_str(&path)?;

        // 发送请求 发送5次
        for i in 0..5 {
            match clash_api::put_configs(path).await {
                Ok(_) => break,
                Err(err) => {
                    if i < 4 {
                        log::info!(target: "app", "{err}");
                    } else {
                        bail!(err);
                    }
                }
            }
            sleep(Duration::from_millis(250)).await;
        }

        Ok(())
    }
}

use super::{clash_api, logger::Logger};
use crate::{
    config::*,
    enhance, log_err,
    utils::{self, dirs},
};
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

    pub runtime_config: Arc<Mutex<RuntimeResult>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();

        CORE_MANAGER.get_or_init(|| CoreManager {
            sidecar: Arc::new(Mutex::new(None)),
            runtime_config: Arc::new(Mutex::new(RuntimeResult::default())),
            use_service_mode: Arc::new(Mutex::new(false)),
        })
    }

    pub fn init(&self) -> Result<()> {
        // kill old clash process
        if let Ok(pid) = fs::read(dirs::clash_pid_path()) {
            if let Ok(pid) = String::from_utf8_lossy(&pid).parse() {
                let mut system = System::new();
                system.refresh_all();
                system.process(Pid::from_u32(pid)).map(|proc| {
                    if proc.name().contains("clash") {
                        proc.kill();
                    }
                });
            }
        }

        tauri::async_runtime::spawn(async {
            // 启动clash
            if Self::global().run_core().await.is_ok() {
                // 更新配置
                sleep(Duration::from_millis(100)).await;
                crate::log_err!(Self::global().activate_config().await);
            }
        });

        Ok(())
    }

    /// 检查配置是否正确
    pub fn check_config(&self) -> Result<()> {
        let config_path = dirs::clash_runtime_yaml();
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("clash".into());

        let output = Command::new_sidecar(clash_core)?
            .args(["-t", "-f", config_path])
            .output()?;

        if !output.status.success() {
            Logger::global().set_log(output.stdout.clone());
            bail!("{}", output.stdout); // 过滤掉终端颜色值
        }

        Ok(())
    }

    /// 启动核心
    pub async fn run_core(&self) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            use super::win_service;

            // 服务模式
            let enable = {
                let enable = Config::verge().data().enable_service_mode.clone();
                enable.unwrap_or(false)
            };

            *self.use_service_mode.lock() = enable;

            if enable {
                // 服务模式启动失败就直接运行sidecar
                match {
                    win_service::check_service().await?;
                    win_service::run_core_by_service().await
                } {
                    Ok(_) => return Ok(()),
                    Err(err) => {
                        // 修改这个值，免得stop出错
                        *self.use_service_mode.lock() = false;

                        log::error!(target: "app", "{err}");
                    }
                }
            }
        }

        let mut sidecar = self.sidecar.lock();

        if let Some(child) = sidecar.take() {
            let _ = child.kill();
        }

        let app_dir = dirs::app_home_dir();
        let app_dir = dirs::path_to_str(&app_dir)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("clash".into());

        // fix #212
        let args = match clash_core.as_str() {
            "clash-meta" => vec!["-m", "-d", app_dir],
            _ => vec!["-d", app_dir],
        };

        let cmd = Command::new_sidecar(clash_core)?;
        let (mut rx, cmd_child) = cmd.args(args).spawn()?;

        // 将pid写入文件中
        crate::log_err!({
            let pid = cmd_child.pid();
            let path = dirs::clash_pid_path();
            fs::File::create(path)
                .context("failed to create the pid file")?
                .write(format!("{pid}").as_bytes())
                .context("failed to write pid to the file")?;
            <Result<()>>::Ok(())
        });

        *sidecar = Some(cmd_child);

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let can_short = line.starts_with("time=") && line.len() > 33;
                        let stdout = if can_short { &line[33..] } else { &line };
                        log::info!(target: "app" ,"[clash]: {}", stdout);
                        Logger::global().set_log(line);
                    }
                    CommandEvent::Stderr(err) => {
                        log::error!(target: "app" ,"[clash]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Error(err) => {
                        log::error!(target: "app" ,"[clash]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Terminated(_) => {
                        log::info!(target: "app" ,"clash core terminated");
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// 停止核心运行
    pub fn stop_core(&self) -> Result<()> {
        #[cfg(target_os = "windows")]
        if *self.use_service_mode.lock() {
            tauri::async_runtime::block_on(async move {
                log_err!(super::win_service::stop_core_by_service().await);
            });
            return Ok(());
        }

        let mut sidecar = self.sidecar.lock();
        if let Some(child) = sidecar.take() {
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

        // 清掉旧日志
        Logger::global().clear_log();

        {
            Config::verge().draft().clash_core = Some(clash_core);
        }

        match self.run_core().await {
            Ok(_) => {
                log_err!({
                    Config::verge().apply();
                    Config::verge().latest().save_file()
                });

                sleep(Duration::from_millis(100)).await; // 等一会儿再更新配置
                self.activate_config().await?;
                Ok(())
            }
            Err(err) => {
                Config::verge().discard();
                Err(err)
            }
        }
    }

    /// 激活一个配置
    pub async fn activate_config(&self) -> Result<()> {
        let clash_config = { Config::clash().latest().clone() };

        let tun_mode = { Config::verge().latest().enable_tun_mode.clone() };
        let tun_mode = tun_mode.unwrap_or(false);

        let pa = { Config::profiles().latest().gen_activate()? };

        let (config, exists_keys, logs) =
            enhance::enhance_config(clash_config.0, pa.current, pa.chain, pa.valid, tun_mode);

        // 保存到文件中
        let runtime_path = dirs::clash_runtime_yaml();
        utils::config::save_yaml(runtime_path, &config, Some("# Clash Verge Runtime Config"))?;

        // 检查配置是否正常
        self.check_config()?;

        // 发送请求 发送5次
        for i in 0..5 {
            match clash_api::put_configs().await {
                Ok(_) => break,
                Err(err) => {
                    if i < 4 {
                        log::error!(target: "app", "{err}");
                    } else {
                        bail!(err);
                    }
                }
            }
            sleep(Duration::from_millis(250)).await;
        }

        // 保存结果
        let mut runtime = self.runtime_config.lock();
        let config_yaml = Some(serde_yaml::to_string(&config).unwrap_or("".into()));
        *runtime = RuntimeResult {
            config: Some(config),
            config_yaml,
            exists_keys,
            chain_logs: logs,
        };

        Ok(())
    }
}

use crate::config::*;
use crate::core::mihomo::MihomoClientManager;
use crate::core::{mihomo, handle, logger::Logger, service};
use crate::log_err;
use crate::utils::dirs;
use crate::utils::resolve::find_unused_port;
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde_yaml::Mapping;
use std::path::PathBuf;
use std::{sync::Arc, time::Duration};
use sysinfo::System;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

use super::verge_log::VergeLog;

#[derive(Debug)]
pub struct CoreManager {
    /// clash sidecar process
    sidecar: Arc<Mutex<Option<CommandChild>>>,

    /// true if clash core is running in service mode
    use_service_mode: Arc<Mutex<bool>>,

    /// true if clash core needs to be restarted when it is terminated
    need_restart_core: Arc<Mutex<bool>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();

        CORE_MANAGER.get_or_init(|| CoreManager {
            sidecar: Arc::new(Mutex::new(None)),
            use_service_mode: Arc::new(Mutex::new(false)),
            need_restart_core: Arc::new(Mutex::new(true)),
        })
    }

    pub fn init(&self) -> Result<()> {
        tauri::async_runtime::spawn(async {
            let enable_random_port = Config::verge().latest().enable_random_port.unwrap_or(false);
            if enable_random_port {
                let port = find_unused_port().unwrap_or(Config::clash().latest().get_mixed_port());
                let mut port_mapping = Mapping::new();
                port_mapping.insert("mixed-port".into(), port.into());
                port_mapping.insert("port".into(), 0.into());
                port_mapping.insert("socks-port".into(), 0.into());
                port_mapping.insert("redir-port".into(), 0.into());
                port_mapping.insert("tproxy-port".into(), 0.into());
                // patch config
                Config::clash()
                    .latest()
                    .patch_config(port_mapping.clone().into());
                log_err!(Config::clash().latest().save_config());
                Config::runtime().latest().patch_config(port_mapping);
            }
            // 启动 clash
            log_err!(Self::global().run_core().await);
        });

        Ok(())
    }

    /// 检查订阅是否正确
    pub async fn check_config(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Check)?;
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("clash".into());

        let app_dir = dirs::app_home_dir()?;
        let app_dir = dirs::path_to_str(&app_dir)?;
        let app_handle = handle::Handle::global().get_app_handle()?;
        let output = app_handle
            .shell()
            .sidecar(clash_core)?
            .args(["-t", "-d", app_dir, "-f", config_path])
            .output()
            .await?;

        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout.clone()).into_owned();
            let error = mihomo::parse_check_output(stdout.clone());
            let error = match !error.is_empty() {
                true => error,
                false => stdout.clone(),
            };
            Logger::global().set_log(stdout);
            bail!("{error}");
        }

        Ok(())
    }

    /// 启动核心
    pub async fn run_core(&self) -> Result<()> {
        let config_path = Config::generate_file(ConfigType::Run)?;

        let mut disable = Mapping::new();
        let mut tun = Mapping::new();
        tun.insert("enable".into(), false.into());
        disable.insert("tun".into(), tun.into());

        if self.sidecar.lock().is_some() {
            *self.need_restart_core.lock() = false;
            self.sidecar.lock().take();
            // 关闭 tun 模式
            log::debug!(target: "app", "disable tun mode");
            let _ = MihomoClientManager::global()
                .mihomo()
                .patch_base_config(&disable)
                .await;
        }

        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            log_err!(service::stop_core_by_service().await);
        }

        // 服务模式
        let enable = Config::verge().latest().enable_service_mode;
        let enable = enable.unwrap_or(false);
        *self.use_service_mode.lock() = enable;

        let mut system = System::new();
        system.refresh_all();
        let procs = system.processes_by_name("verge-mihomo".as_ref());
        for proc in procs {
            log::debug!(target: "app", "kill all clash process");
            proc.kill();
        }

        if enable {
            // 服务模式启动失败就直接运行 sidecar
            // log::debug!(target: "app", "try to run core in service mode");
            let verge_log = VergeLog::global();
            let log_path = match verge_log.get_service_log_file() {
                Some(log_path) => {
                    log::info!("service log file: {log_path}");
                    log_path
                }
                None => {
                    let log_path = verge_log.create_service_log_file()?;
                    log::info!("service log file: {log_path}");
                    log_path
                }
            };

            let res = service::run_core_by_service(&config_path, &PathBuf::from(log_path)).await;
            match res {
                Ok(_) => return Ok(()),
                Err(err) => {
                    // 修改这个值，免得stop出错
                    *self.use_service_mode.lock() = false;
                    log::error!(target: "app", "{err}");
                }
            }
        } else {
            VergeLog::global().reset_service_log_file();
            // service mode is disable, patch the config: disable tun mode
            Config::clash()
                .latest()
                .patch_and_merge_config(disable.clone());
            Config::clash().latest().save_config()?;
            Config::runtime().latest().patch_config(disable.clone());
            Config::generate_file(ConfigType::Run)?;
            // emit refresh clash event and update tray menu
            handle::Handle::refresh_clash();
            handle::Handle::update_systray_part()?;
        }

        let app_dir = dirs::app_home_dir()?;
        let app_dir = dirs::path_to_str(&app_dir)?;
        let clash_core = { Config::verge().latest().clash_core.clone() };
        let clash_core = clash_core.unwrap_or("verge-mihomo".into());

        let config_path = dirs::path_to_str(&config_path)?;
        let args = vec!["-d", app_dir, "-f", config_path];

        let app_handle = handle::Handle::global().get_app_handle()?;
        let cmd = app_handle.shell().sidecar(clash_core)?;
        let (mut rx, cmd_child) = cmd.args(args).spawn()?;
        {
            let mut sidecar = self.sidecar.lock();
            *sidecar = Some(cmd_child);
        }
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

        Ok(())
    }

    /// 重启内核
    pub fn recover_core(&'static self) -> Result<()> {
        // 服务模式 / 切换内核 不进行恢复
        if *self.use_service_mode.lock() || !*self.need_restart_core.lock() {
            return Ok(());
        }
        // 清空原来的 sidecar 值
        let _ = self.sidecar.lock().take();

        tauri::async_runtime::spawn(async move {
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
        *self.need_restart_core.lock() = false;
        // 关闭tun模式
        tauri::async_runtime::block_on(async move {
            let mut disable = Mapping::new();
            let mut tun = Mapping::new();
            tun.insert("enable".into(), false.into());
            disable.insert("tun".into(), tun.into());
            log::debug!(target: "app", "disable tun mode");
            let _ = MihomoClientManager::global()
                .mihomo()
                .patch_base_config(&disable)
                .await;
        });

        if *self.use_service_mode.lock() {
            log::debug!(target: "app", "stop the core by service");
            tauri::async_runtime::block_on(async move {
                log_err!(service::stop_core_by_service().await);
            });
            return Ok(());
        }

        {
            let mut sidecar = self.sidecar.lock();
            let _ = sidecar.take();
        }

        let mut system = System::new();
        system.refresh_all();
        let procs = system.processes_by_name("verge-mihomo".as_ref());
        for proc in procs {
            log::debug!(target: "app", "kill all clash process");
            proc.kill();
        }
        Ok(())
    }

    /// 切换核心
    pub async fn change_core(&self, clash_core: Option<String>) -> Result<()> {
        *self.need_restart_core.lock() = false;

        let clash_core = clash_core.ok_or(anyhow::anyhow!("clash core is null"))?;
        const CLASH_CORES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];
        if !CLASH_CORES.contains(&clash_core.as_str()) {
            bail!("invalid clash core name \"{clash_core}\"");
        }

        log::debug!(target: "app", "change core to `{clash_core}`");
        Config::verge().draft().clash_core = Some(clash_core);
        // 更新订阅
        Config::generate()?;
        self.check_config().await?;
        // 清掉旧日志
        Logger::global().clear_log();

        match self.run_core().await {
            Ok(_) => {
                Config::verge().apply();
                Config::runtime().apply();
                log_err!(Config::verge().latest().save_file());
                *self.need_restart_core.lock() = true;
                Ok(())
            }
            Err(err) => {
                Config::verge().discard();
                Config::runtime().discard();
                *self.need_restart_core.lock() = true;
                Err(err)
            }
        }
    }

    /// 更新proxies那些
    /// 如果涉及端口和外部控制则需要重启
    pub async fn update_config(&self, restart_core: bool) -> Result<()> {
        log::debug!(target: "app", "try to update clash config, restart core: {restart_core}");

        // 更新订阅
        Config::generate()?;

        // 检查订阅是否正常
        self.check_config().await?;

        // 是否需要重启核心
        if restart_core {
            self.run_core().await?;
            return Ok(());
        }

        // 更新运行时订阅
        let path = Config::generate_file(ConfigType::Run)?;
        let path = dirs::path_to_str(&path)?;

        // 发送请求 发送5次
        for i in 0..5 {
            match MihomoClientManager::global()
                .mihomo()
                .reload_config(true, path)
                .await
            {
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

use super::{clash_api, logger::Logger};
use crate::{
    config::*,
    enhance,
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
    clash_core: Arc<Mutex<String>>,

    sidecar: Arc<Mutex<Option<CommandChild>>>,

    #[allow(unused)]
    use_service_mode: Arc<Mutex<bool>>,

    pub runtime_config: Arc<Mutex<RuntimeResult>>,
}

impl CoreManager {
    pub fn global() -> &'static CoreManager {
        static CORE_MANAGER: OnceCell<CoreManager> = OnceCell::new();

        CORE_MANAGER.get_or_init(|| CoreManager {
            clash_core: Arc::new(Mutex::new("clash".into())),
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

        // 使用配置的核心
        let verge = VergeN::global().config.lock();
        if let Some(verge_core) = verge.clash_core.as_ref() {
            if verge_core == "clash" || verge_core == "clash-meta" {
                let mut clash_core = self.clash_core.lock();
                *clash_core = verge_core.clone();
            }
        }

        // 启动clash
        self.run_core()?;

        // 更新配置
        tauri::async_runtime::spawn(async {
            sleep(Duration::from_millis(100)).await;
            crate::log_err!(Self::global().activate_config().await);
        });

        Ok(())
    }

    /// 检查配置是否正确
    pub fn check_config(&self) -> Result<()> {
        let config_path = dirs::clash_runtime_yaml();
        let config_path = dirs::path_to_str(&config_path)?;

        let clash_core = { self.clash_core.lock().clone() };

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
    pub fn run_core(&self) -> Result<()> {
        // 先纠正重要的配置字段
        self.correct_config()?;

        let mut sidecar = self.sidecar.lock();

        if let Some(child) = sidecar.take() {
            let _ = child.kill();
        }

        let app_dir = dirs::app_home_dir();
        let app_dir = dirs::path_to_str(&app_dir)?;

        let clash_core = { self.clash_core.lock().clone() };

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
                        log::error!(target: "app" ,"[clash error]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Error(err) => {
                        log::error!(target: "app" ,"[clash error]: {err}");
                        Logger::global().set_log(err);
                    }
                    CommandEvent::Terminated(_) => {
                        log::info!(target: "app" ,"clash core Terminated");
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

        let old_core = {
            let mut self_core = self.clash_core.lock();
            let old_core = self_core.to_owned(); // 保存一下旧值
            *self_core = clash_core.clone();
            old_core
        };

        match self.run_core() {
            Ok(_) => {
                // 更新到配置文件
                {
                    VergeN::global().config.lock().clash_core = Some(clash_core);
                }

                let _ = VergeN::global().save_file();

                sleep(Duration::from_millis(100)).await; // 等一会儿再更新配置
                self.activate_config().await?;
                Ok(())
            }
            Err(err) => {
                // 恢复旧的值
                let mut self_core = self.clash_core.lock();
                *self_core = old_core;
                Err(err)
            }
        }
    }

    /// 纠正一下配置
    /// 将mixed-port和external-controller都改为配置的内容
    pub fn correct_config(&self) -> Result<()> {
        // todo!()
        Ok(())
    }

    /// 激活一个配置
    pub async fn activate_config(&self) -> Result<()> {
        let clash_config = { ClashN::global().config.lock().clone() };

        let tun_mode = { VergeN::global().config.lock().enable_tun_mode.clone() };
        let tun_mode = tun_mode.unwrap_or(false);

        let pa = { ProfilesN::global().config.lock().gen_activate()? };

        let (config, exists_keys, logs) =
            enhance::enhance_config(clash_config, pa.current, pa.chain, pa.valid, tun_mode);

        // 保存到文件中
        let runtime_path = dirs::clash_runtime_yaml();
        utils::config::save_yaml(runtime_path, &config, Some("# Clash Verge Runtime Config"))?;

        // 检查配置是否正常
        self.check_config()?;

        // todo 是否需要检查核心是否运行

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

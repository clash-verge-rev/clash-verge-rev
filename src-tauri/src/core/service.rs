use crate::data::{ClashInfo, Data};
use crate::log_if_err;
use crate::utils::{config, dirs};
use anyhow::{bail, Result};
use parking_lot::RwLock;
use reqwest::header::HeaderMap;
use serde_yaml::Mapping;
use std::fs;
use std::io::Write;
use std::sync::Arc;
use std::{
  collections::{HashMap, VecDeque},
  time::Duration,
};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tokio::time::sleep;

const LOGS_QUEUE_LEN: usize = 100;

#[derive(Debug)]
pub struct Service {
  sidecar: Option<CommandChild>,

  logs: Arc<RwLock<VecDeque<String>>>,

  #[allow(unused)]
  use_service_mode: bool,
}

impl Service {
  pub fn new() -> Service {
    let queue = VecDeque::with_capacity(LOGS_QUEUE_LEN + 10);

    Service {
      sidecar: None,
      logs: Arc::new(RwLock::new(queue)),
      use_service_mode: false,
    }
  }

  pub fn start(&mut self) -> Result<()> {
    #[cfg(not(target_os = "windows"))]
    self.start_clash_by_sidecar()?;

    #[cfg(target_os = "windows")]
    {
      let enable = {
        let data = Data::global();
        let verge = data.verge.lock();
        verge.enable_service_mode.clone().unwrap_or(false)
      };

      self.use_service_mode = enable;

      if !enable {
        return self.start_clash_by_sidecar();
      }

      tauri::async_runtime::spawn(async move {
        match Self::check_service().await {
          Ok(status) => {
            // 未启动clash
            if status.code != 0 {
              log_if_err!(Self::start_clash_by_service().await);
            }
          }
          Err(err) => log::error!(target: "app", "{err}"),
        }
      });
    }

    Ok(())
  }

  pub fn stop(&mut self) -> Result<()> {
    #[cfg(not(target_os = "windows"))]
    self.stop_clash_by_sidecar()?;

    #[cfg(target_os = "windows")]
    {
      let _ = self.stop_clash_by_sidecar();

      if self.use_service_mode {
        tauri::async_runtime::block_on(async move {
          log_if_err!(Self::stop_clash_by_service().await);
        });
      }
    }

    Ok(())
  }

  pub fn restart(&mut self) -> Result<()> {
    self.stop()?;
    self.start()
  }

  pub fn get_logs(&self) -> VecDeque<String> {
    self.logs.read().clone()
  }

  #[allow(unused)]
  pub fn set_logs(&self, text: String) {
    let mut logs = self.logs.write();
    if logs.len() > LOGS_QUEUE_LEN {
      (*logs).pop_front();
    }
    (*logs).push_back(text);
  }

  pub fn clear_logs(&self) {
    let mut logs = self.logs.write();
    (*logs).clear();
  }

  /// start the clash sidecar
  fn start_clash_by_sidecar(&mut self) -> Result<()> {
    if self.sidecar.is_some() {
      let sidecar = self.sidecar.take().unwrap();
      let _ = sidecar.kill();
    }

    let clash_core: String = {
      let global = Data::global();
      let verge = global.verge.lock();
      verge.clash_core.clone().unwrap_or("clash".into())
    };

    let app_dir = dirs::app_home_dir();
    let app_dir = app_dir.as_os_str().to_str().unwrap();

    // fix #212
    let args = match clash_core.as_str() {
      "clash-meta" => vec!["-m", "-d", app_dir],
      _ => vec!["-d", app_dir],
    };

    let cmd = Command::new_sidecar(clash_core)?;

    let (mut rx, cmd_child) = cmd.args(args).spawn()?;

    // 将pid写入文件中
    let pid = cmd_child.pid();
    log_if_err!(|| -> Result<()> {
      let path = dirs::clash_pid_path();
      fs::File::create(path)?.write(format!("{pid}").as_bytes())?;
      Ok(())
    }());

    self.sidecar = Some(cmd_child);

    // clash log
    let logs = self.logs.clone();
    tauri::async_runtime::spawn(async move {
      let write_log = |text: String| {
        let mut logs = logs.write();
        if logs.len() >= LOGS_QUEUE_LEN {
          (*logs).pop_front();
        }
        (*logs).push_back(text);
      };

      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Stdout(line) => {
            let can_short = line.starts_with("time=") && line.len() > 33;
            let stdout = if can_short { &line[33..] } else { &line };
            log::info!(target: "app" ,"[clash]: {}", stdout);
            write_log(line);
          }
          CommandEvent::Stderr(err) => {
            log::error!(target: "app" ,"[clash error]: {}", err);
            write_log(err);
          }
          CommandEvent::Error(err) => log::error!(target: "app" ,"{err}"),
          CommandEvent::Terminated(_) => break,
          _ => {}
        }
      }
    });

    Ok(())
  }

  /// stop the clash sidecar
  fn stop_clash_by_sidecar(&mut self) -> Result<()> {
    if let Some(sidecar) = self.sidecar.take() {
      sidecar.kill()?;
    }
    Ok(())
  }

  pub fn check_start(&mut self) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
      let global = Data::global();
      let verge = global.verge.lock();
      let service_mode = verge.enable_service_mode.unwrap_or(false);

      if !service_mode && self.sidecar.is_none() {
        self.start()?;
      }
    }

    #[cfg(not(target_os = "windows"))]
    if self.sidecar.is_none() {
      self.start()?;
    }

    Ok(())
  }

  /// update clash config
  /// using PUT methods
  pub async fn set_config(info: ClashInfo, config: Mapping) -> Result<()> {
    let temp_path = dirs::profiles_temp_path();
    config::save_yaml(temp_path.clone(), &config, Some("# Clash Verge Temp File"))?;

    let (server, headers) = Self::clash_client_info(info)?;

    let mut data = HashMap::new();
    data.insert("path", temp_path.as_os_str().to_str().unwrap());

    macro_rules! report_err {
      ($i: expr, $e: expr) => {
        match $i {
          4 => bail!($e),
          _ => log::error!(target: "app", $e),
        }
      };
    }

    // retry 5 times
    for i in 0..5 {
      let headers = headers.clone();
      match reqwest::ClientBuilder::new().no_proxy().build() {
        Ok(client) => {
          let builder = client.put(&server).headers(headers).json(&data);
          match builder.send().await {
            Ok(resp) => match resp.status().as_u16() {
              204 => break,
              // 配置有问题不重试
              400 => bail!("failed to update clash config with status 400"),
              status @ _ => report_err!(i, "failed to activate clash with status \"{status}\""),
            },
            Err(err) => report_err!(i, "{err}"),
          }
        }
        Err(err) => report_err!(i, "{err}"),
      }
      sleep(Duration::from_millis(500)).await;
    }

    Ok(())
  }

  /// patch clash config
  pub async fn patch_config(info: ClashInfo, config: Mapping) -> Result<()> {
    let (server, headers) = Self::clash_client_info(info)?;

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let builder = client.patch(&server).headers(headers.clone()).json(&config);
    builder.send().await?;
    Ok(())
  }

  /// get clash client url and headers from clash info
  fn clash_client_info(info: ClashInfo) -> Result<(String, HeaderMap)> {
    if info.server.is_none() {
      let status = &info.status;
      if info.port.is_none() {
        bail!("failed to parse config.yaml file with status {status}");
      } else {
        bail!("failed to parse the server with status {status}");
      }
    }

    let server = info.server.unwrap();
    let server = format!("http://{server}/configs");

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse().unwrap());

    if let Some(secret) = info.secret.as_ref() {
      let secret = format!("Bearer {}", secret.clone()).parse().unwrap();
      headers.insert("Authorization", secret);
    }

    Ok((server, headers))
  }

  /// kill old clash process
  pub fn kill_old_clash() {
    use sysinfo::{Pid, PidExt, ProcessExt, System, SystemExt};

    if let Ok(pid) = fs::read(dirs::clash_pid_path()) {
      if let Ok(pid) = String::from_utf8_lossy(&pid).parse() {
        let mut system = System::new();
        system.refresh_all();

        let proc = system.process(Pid::from_u32(pid));
        if let Some(proc) = proc {
          proc.kill();
        }
      }
    }
  }
}

impl Drop for Service {
  fn drop(&mut self) {
    log_if_err!(self.stop());
  }
}

/// ### Service Mode
///
#[cfg(target_os = "windows")]
pub mod win_service {
  use super::*;
  use anyhow::Context;
  use deelevate::{PrivilegeLevel, Token};
  use runas::Command as RunasCommand;
  use serde::{Deserialize, Serialize};
  use std::os::windows::process::CommandExt;
  use std::{env::current_exe, process::Command as StdCommand};

  const SERVICE_NAME: &str = "clash_verge_service";

  const SERVICE_URL: &str = "http://127.0.0.1:33211";

  #[derive(Debug, Deserialize, Serialize, Clone)]
  pub struct ResponseBody {
    pub bin_path: String,
    pub config_dir: String,
    pub log_file: String,
  }

  #[derive(Debug, Deserialize, Serialize, Clone)]
  pub struct JsonResponse {
    pub code: u64,
    pub msg: String,
    pub data: Option<ResponseBody>,
  }

  impl Service {
    /// Install the Clash Verge Service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn install_service() -> Result<()> {
      let binary_path = dirs::service_path();
      let install_path = binary_path.with_file_name("install-service.exe");

      if !install_path.exists() {
        bail!("installer exe not found");
      }

      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(install_path).status()?,
        _ => StdCommand::new(install_path)
          .creation_flags(0x08000000)
          .status()?,
      };

      if !status.success() {
        bail!(
          "failed to install service with status {}",
          status.code().unwrap()
        );
      }

      Ok(())
    }

    /// Uninstall the Clash Verge Service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn uninstall_service() -> Result<()> {
      let binary_path = dirs::service_path();
      let uninstall_path = binary_path.with_file_name("uninstall-service.exe");

      if !uninstall_path.exists() {
        bail!("uninstaller exe not found");
      }

      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).status()?,
        _ => StdCommand::new(uninstall_path)
          .creation_flags(0x08000000)
          .status()?,
      };

      if !status.success() {
        bail!(
          "failed to uninstall service with status {}",
          status.code().unwrap()
        );
      }

      Ok(())
    }

    /// [deprecated]
    /// start service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn start_service() -> Result<()> {
      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let args = ["start", SERVICE_NAME];

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new("sc").args(&args).status()?,
        _ => StdCommand::new("sc").args(&args).status()?,
      };

      match status.success() {
        true => Ok(()),
        false => bail!(
          "failed to start service with status {}",
          status.code().unwrap()
        ),
      }
    }

    /// stop service
    pub async fn stop_service() -> Result<()> {
      let url = format!("{SERVICE_URL}/stop_service");
      let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

      if res.code != 0 {
        bail!(res.msg);
      }

      Ok(())
    }

    /// check the windows service status
    pub async fn check_service() -> Result<JsonResponse> {
      let url = format!("{SERVICE_URL}/get_clash");
      let response = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .get(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

      Ok(response)
    }

    /// start the clash by service
    pub(super) async fn start_clash_by_service() -> Result<()> {
      let status = Self::check_service().await?;

      if status.code == 0 {
        Self::stop_clash_by_service().await?;
        sleep(Duration::from_secs(1)).await;
      }

      let clash_core = {
        let global = Data::global();
        let verge = global.verge.lock();
        verge.clash_core.clone().unwrap_or("clash".into())
      };

      let clash_bin = format!("{clash_core}.exe");
      let bin_path = current_exe().unwrap().with_file_name(clash_bin);
      let bin_path = bin_path.as_os_str().to_str().unwrap();

      let config_dir = dirs::app_home_dir();
      let config_dir = config_dir.as_os_str().to_str().unwrap();

      let log_path = dirs::service_log_file();
      let log_path = log_path.as_os_str().to_str().unwrap();

      let mut map = HashMap::new();
      map.insert("bin_path", bin_path);
      map.insert("config_dir", config_dir);
      map.insert("log_file", log_path);

      let url = format!("{SERVICE_URL}/start_clash");
      let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .json(&map)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

      if res.code != 0 {
        bail!(res.msg);
      }

      Ok(())
    }

    /// stop the clash by service
    pub(super) async fn stop_clash_by_service() -> Result<()> {
      let url = format!("{SERVICE_URL}/stop_clash");
      let res = reqwest::ClientBuilder::new()
        .no_proxy()
        .build()?
        .post(url)
        .send()
        .await?
        .json::<JsonResponse>()
        .await
        .context("failed to connect to the Clash Verge Service")?;

      if res.code != 0 {
        bail!(res.msg);
      }

      Ok(())
    }
  }
}

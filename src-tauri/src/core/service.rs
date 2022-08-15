use super::{notice::Notice, ClashInfo};
use crate::log_if_err;
use crate::utils::{config, dirs};
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde_yaml::Mapping;
use std::{collections::HashMap, time::Duration};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tokio::time::sleep;

static mut CLASH_CORE: &str = "clash";

#[derive(Debug)]
pub struct Service {
  sidecar: Option<CommandChild>,

  #[allow(unused)]
  service_mode: bool,
}

impl Service {
  pub fn new() -> Service {
    Service {
      sidecar: None,
      service_mode: false,
    }
  }

  pub fn set_core(&mut self, clash_core: Option<String>) {
    unsafe {
      CLASH_CORE = Box::leak(clash_core.unwrap_or("clash".into()).into_boxed_str());
    }
  }

  #[allow(unused)]
  pub fn set_mode(&mut self, enable: bool) {
    self.service_mode = enable;
  }

  #[cfg(not(windows))]
  pub fn start(&mut self) -> Result<()> {
    self.start_clash_by_sidecar()
  }

  #[cfg(windows)]
  pub fn start(&mut self) -> Result<()> {
    if !self.service_mode {
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

    Ok(())
  }

  #[cfg(not(windows))]
  pub fn stop(&mut self) -> Result<()> {
    self.stop_clash_by_sidecar()
  }

  #[cfg(windows)]
  pub fn stop(&mut self) -> Result<()> {
    if !self.service_mode {
      return self.stop_clash_by_sidecar();
    }

    tauri::async_runtime::spawn(async move {
      log_if_err!(Self::stop_clash_by_service().await);
    });

    Ok(())
  }

  pub fn restart(&mut self) -> Result<()> {
    self.stop()?;
    self.start()
  }

  /// start the clash sidecar
  fn start_clash_by_sidecar(&mut self) -> Result<()> {
    if self.sidecar.is_some() {
      bail!("could not run clash sidecar twice");
    }

    let app_dir = dirs::app_home_dir();
    let app_dir = app_dir.as_os_str().to_str().unwrap();

    let clash_core = unsafe { CLASH_CORE };
    let cmd = Command::new_sidecar(clash_core)?;
    let (mut rx, cmd_child) = cmd.args(["-d", app_dir]).spawn()?;

    self.sidecar = Some(cmd_child);

    // clash log
    tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Stdout(line) => {
            let stdout = if line.len() > 33 { &line[33..] } else { &line };
            log::info!(target: "app" ,"[clash]: {}", stdout);
          }
          CommandEvent::Stderr(err) => log::error!(target: "app" ,"[clash error]: {}", err),
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

  /// update clash config
  /// using PUT methods
  pub fn set_config(&self, info: ClashInfo, config: Mapping, notice: Notice) -> Result<()> {
    if !self.service_mode && self.sidecar.is_none() {
      bail!("did not start sidecar");
    }

    let temp_path = dirs::profiles_temp_path();
    config::save_yaml(temp_path.clone(), &config, Some("# Clash Verge Temp File"))?;

    let (server, headers) = Self::clash_client_info(info)?;

    tauri::async_runtime::spawn(async move {
      let mut data = HashMap::new();
      data.insert("path", temp_path.as_os_str().to_str().unwrap());

      // retry 5 times
      for _ in 0..5 {
        match reqwest::ClientBuilder::new().no_proxy().build() {
          Ok(client) => {
            let builder = client.put(&server).headers(headers.clone()).json(&data);

            match builder.send().await {
              Ok(resp) => {
                if resp.status() != 204 {
                  log::error!(target: "app", "failed to activate clash with status \"{}\"", resp.status());
                }

                notice.refresh_clash();

                // do not retry
                break;
              }
              Err(err) => log::error!(target: "app", "failed to activate for `{err}`"),
            }
          }
          Err(err) => log::error!(target: "app", "failed to activate for `{err}`"),
        }
        sleep(Duration::from_millis(500)).await;
      }
    });

    Ok(())
  }

  /// patch clash config
  pub fn patch_config(&self, info: ClashInfo, config: Mapping, notice: Notice) -> Result<()> {
    if !self.service_mode && self.sidecar.is_none() {
      bail!("did not start sidecar");
    }

    let (server, headers) = Self::clash_client_info(info)?;

    tauri::async_runtime::spawn(async move {
      if let Ok(client) = reqwest::ClientBuilder::new().no_proxy().build() {
        let builder = client.patch(&server).headers(headers.clone()).json(&config);

        match builder.send().await {
          Ok(_) => notice.refresh_clash(),
          Err(err) => log::error!(target: "app", "{err}"),
        }
      }
    });

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
}

impl Drop for Service {
  fn drop(&mut self) {
    log_if_err!(self.stop());
  }
}

/// ### Service Mode
///
#[cfg(windows)]
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

      let clash_core = unsafe { CLASH_CORE };
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

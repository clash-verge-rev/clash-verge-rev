use super::{notice::Notice, ClashInfo};
use crate::log_if_err;
use crate::utils::{config, dirs};
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::{collections::HashMap, time::Duration};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tokio::time::sleep;

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
            if let Err(err) = Self::start_clash_by_service().await {
              log::error!("{err}");
            }
          }
        }
        Err(err) => log::error!("{err}"),
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
      if let Err(err) = Self::stop_clash_by_service().await {
        log::error!("{err}");
      }
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

    let cmd = Command::new_sidecar("clash")?;
    let (mut rx, cmd_child) = cmd.args(["-d", app_dir]).spawn()?;

    self.sidecar = Some(cmd_child);

    // clash log
    tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Stdout(line) => log::info!("[clash]: {}", line),
          CommandEvent::Stderr(err) => log::error!("[clash]: {}", err),
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

    if info.server.is_none() {
      bail!("failed to parse the server");
    }

    let server = info.server.unwrap();
    let server = format!("http://{server}/configs");

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse().unwrap());

    if let Some(secret) = info.secret.as_ref() {
      let secret = format!("Bearer {}", secret.clone()).parse().unwrap();
      headers.insert("Authorization", secret);
    }

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
                  log::error!("failed to activate clash with status \"{}\"", resp.status());
                }

                notice.refresh_clash();

                // do not retry
                break;
              }
              Err(err) => log::error!("failed to activate for `{err}`"),
            }
          }
          Err(err) => log::error!("failed to activate for `{err}`"),
        }
        sleep(Duration::from_millis(500)).await;
      }
    });

    Ok(())
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
  use runas::Command as RunasCommond;
  use std::{env::current_exe, process::Command as StdCommond};

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
      let arg = format!("binpath={}", binary_path.as_os_str().to_string_lossy());

      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let args = [
        "create",
        SERVICE_NAME,
        arg.as_str(),
        "type=own",
        "start=AUTO",
        "displayname=Clash Verge Service",
      ];

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommond::new("sc").args(&args).status()?,
        _ => StdCommond::new("sc").args(&args).status()?,
      };

      if status.success() {
        return Ok(());
      }

      if status.code() == Some(1073i32) {
        bail!("clash verge service is installed");
      }

      bail!(
        "failed to install service with status {}",
        status.code().unwrap()
      )
    }

    /// Uninstall the Clash Verge Service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn uninstall_service() -> Result<()> {
      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let args = ["delete", SERVICE_NAME];

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommond::new("sc").args(&args).status()?,
        _ => StdCommond::new("sc").args(&args).status()?,
      };

      match status.success() {
        true => Ok(()),
        false => bail!(
          "failed to uninstall service with status {}",
          status.code().unwrap()
        ),
      }
    }

    /// start service
    /// 该函数应该在协程或者线程中执行，避免UAC弹窗阻塞主线程
    pub async fn start_service() -> Result<()> {
      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      let args = ["start", SERVICE_NAME];

      let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommond::new("sc").args(&args).status()?,
        _ => StdCommond::new("sc").args(&args).status()?,
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
      let res = reqwest::Client::new()
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
      let response = reqwest::get(url)
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

      let bin_path = current_exe().unwrap().with_file_name("clash.exe");
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
      let res = reqwest::Client::new()
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
      let res = reqwest::Client::new()
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

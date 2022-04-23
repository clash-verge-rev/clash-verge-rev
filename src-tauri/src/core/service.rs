use super::{notice::Notice, ClashInfo};
use crate::log_if_err;
use crate::utils::{config, dirs};
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde_yaml::Mapping;
use std::{collections::HashMap, time::Duration};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tokio::time::sleep;

#[derive(Debug)]
pub struct Service {
  sidecar: Option<CommandChild>,
}

impl Service {
  pub fn new() -> Service {
    Service { sidecar: None }
  }

  pub fn start(&mut self) -> Result<()> {
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

  pub fn stop(&mut self) -> Result<()> {
    if let Some(sidecar) = self.sidecar.take() {
      sidecar.kill()?;
    }
    Ok(())
  }

  pub fn restart(&mut self) -> Result<()> {
    self.stop()?;
    self.start()
  }

  /// update clash config
  /// using PUT methods
  pub fn set_config(&self, info: ClashInfo, config: Mapping, notice: Notice) -> Result<()> {
    if self.sidecar.is_none() {
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
mod win_service {
  use super::*;
  use deelevate::{PrivilegeLevel, Token};
  use runas::Command as RunasCommond;
  use std::process::Command as StdCommond;

  const SERVICE_NAME: &str = "clash_verge_service";

  impl Service {
    /// install the Clash Verge Service (windows only)
    pub fn install_service(&mut self) -> Result<()> {
      let binary_path = dirs::service_path();
      let arg = format!("binpath={}", binary_path.as_os_str().to_string_lossy());

      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      tauri::async_runtime::spawn(async move {
        let args = [
          "create",
          SERVICE_NAME,
          arg.as_str(),
          "type=own",
          "start=AUTO",
          "displayname=Clash Verge Service",
        ];

        let status = match level {
          PrivilegeLevel::NotPrivileged => RunasCommond::new("sc").args(&args).status(),
          _ => StdCommond::new("sc").args(&args).status(),
        };

        match status {
          Ok(status) => {
            if status.success() {
              log::info!("install clash verge service successfully");
            } else if status.code() == Some(1073i32) {
              log::info!("clash verge service is installed");
            } else {
              log::error!(
                "failed to install service with status {}",
                status.code().unwrap()
              );
            }
          }
          Err(err) => log::error!("failed to install service for {err}"),
        }
      });

      Ok(())
    }

    /// uninstall
    pub fn uninstall_service(&mut self) -> Result<()> {
      let token = Token::with_current_process()?;
      let level = token.privilege_level()?;

      tauri::async_runtime::spawn(async move {
        let args = ["delete", SERVICE_NAME];

        let status = match level {
          PrivilegeLevel::NotPrivileged => RunasCommond::new("sc").args(&args).status(),
          _ => StdCommond::new("sc").args(&args).status(),
        };

        match status {
          Ok(status) => {
            if status.success() {
              log::info!("uninstall clash verge service successfully");
            } else {
              log::error!(
                "failed to uninstall service with status {}",
                status.code().unwrap()
              );
            }
          }
          Err(err) => log::error!("failed to uninstall service for {err}"),
        }
      });

      Ok(())
    }
  }
}

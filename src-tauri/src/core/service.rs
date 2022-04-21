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

  #[cfg(windows)]
  pub fn install(&mut self) -> Result<()> {
    use std::{env::current_exe, ffi::OsString};
    use windows_service::{
      service::{ServiceAccess, ServiceErrorControl, ServiceInfo, ServiceStartType, ServiceType},
      service_manager::{ServiceManager, ServiceManagerAccess},
    };

    let manager_access = ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)?;

    let service_binary_path = current_exe().unwrap().with_file_name("clash.exe");

    let service_info = ServiceInfo {
      name: OsString::from("clash_verge_core"),
      display_name: OsString::from("Clash Verge Core"),
      service_type: ServiceType::OWN_PROCESS,
      start_type: ServiceStartType::OnDemand,
      error_control: ServiceErrorControl::Normal,
      executable_path: service_binary_path,
      launch_arguments: vec![],
      dependencies: vec![],
      account_name: None, // run as System
      account_password: None,
    };

    let service = service_manager.create_service(&service_info, ServiceAccess::CHANGE_CONFIG)?;
    service.set_description("Clash Core Service installed by Clash Verge")?;

    Ok(())
  }

  #[cfg(windows)]
  pub fn check_status(&mut self) -> Result<String> {
    use windows_service::{
      service::{ServiceAccess, ServiceState},
      service_manager::{ServiceManager, ServiceManagerAccess},
    };

    let manager_access = ServiceManagerAccess::CONNECT;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)?;

    let service_access = ServiceAccess::QUERY_STATUS; // | ServiceAccess::STOP | ServiceAccess::DELETE;
    let service = service_manager.open_service("clash_verge_core", service_access)?;

    let service_status = service.query_status()?;

    Ok(format!("{:?}", service_status.current_state))
  }

  #[cfg(windows)]
  pub fn start_service(&mut self) -> Result<()> {
    Ok(())
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

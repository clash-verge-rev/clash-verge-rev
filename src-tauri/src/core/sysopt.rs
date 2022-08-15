use super::{Clash, Verge};
use crate::{log_if_err, utils::sysopt::SysProxyConfig};
use anyhow::{bail, Result};
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use std::sync::Arc;
use tauri::{async_runtime::Mutex, utils::platform::current_exe};

pub struct Sysopt {
  /// current system proxy setting
  cur_sysproxy: Option<SysProxyConfig>,

  /// record the original system proxy
  /// recover it when exit
  old_sysproxy: Option<SysProxyConfig>,

  /// helps to auto launch the app
  auto_launch: Option<AutoLaunch>,

  /// record whether the guard async is running or not
  guard_state: Arc<Mutex<bool>>,
}

impl Sysopt {
  pub fn new() -> Sysopt {
    Sysopt {
      cur_sysproxy: None,
      old_sysproxy: None,
      auto_launch: None,
      guard_state: Arc::new(Mutex::new(false)),
    }
  }

  /// init the sysproxy
  pub fn init_sysproxy(&mut self, port: Option<String>, verge: &Verge) {
    if let Some(port) = port {
      let enable = verge.enable_system_proxy.clone().unwrap_or(false);

      self.old_sysproxy = match SysProxyConfig::get_sys() {
        Ok(proxy) => Some(proxy),
        Err(_) => None,
      };

      let bypass = verge.system_proxy_bypass.clone();
      let sysproxy = SysProxyConfig::new(enable, port, bypass);

      if enable {
        if let Err(err) = sysproxy.set_sys() {
          log::error!(target: "app", "failed to set system proxy for `{err}`");
        }
      }

      self.cur_sysproxy = Some(sysproxy);
    }

    // launchs the system proxy guard
    self.guard_proxy();
  }

  /// update the system proxy
  /// when the verge config is changed
  pub fn update_sysproxy(&mut self, enable: Option<bool>, bypass: Option<String>) -> Result<()> {
    let sysproxy = self.cur_sysproxy.take();

    if sysproxy.is_none() {
      bail!("unhandle error for sysproxy is none");
    }

    let mut sysproxy = sysproxy.unwrap();

    if let Some(enable) = enable {
      sysproxy.enable = enable;
    }

    if let Some(bypass) = bypass {
      sysproxy.bypass = bypass;
    }

    self.cur_sysproxy = Some(sysproxy);

    if self.cur_sysproxy.as_ref().unwrap().set_sys().is_err() {
      bail!("failed to set system proxy");
    }

    Ok(())
  }

  /// reset the sysproxy
  pub fn reset_sysproxy(&mut self) {
    if let Some(sysproxy) = self.old_sysproxy.take() {
      // 如果原代理设置是开启的，且域名端口设置和当前的一致，就不恢复原设置
      // https://github.com/zzzgydi/clash-verge/issues/157
      if let Some(cur) = self.cur_sysproxy.as_ref() {
        if sysproxy.enable && cur.server == sysproxy.server {
          return;
        }
      }

      match sysproxy.set_sys() {
        Ok(_) => self.cur_sysproxy = None,
        Err(_) => log::error!(target: "app", "failed to reset proxy"),
      }
    }
  }

  /// get current proxy
  pub fn get_sysproxy(&self) -> Result<Option<SysProxyConfig>> {
    Ok(self.cur_sysproxy.clone())
  }

  /// init the auto launch
  pub fn init_launch(&mut self, enable: Option<bool>) -> Result<()> {
    let app_exe = current_exe().unwrap();
    let app_exe = dunce::canonicalize(app_exe).unwrap();
    let app_name = app_exe.file_stem().unwrap().to_str().unwrap();
    let app_path = app_exe.as_os_str().to_str().unwrap();

    // fix issue #26
    #[cfg(target_os = "windows")]
    let app_path = format!("\"{app_path}\"");
    #[cfg(target_os = "windows")]
    let app_path = app_path.as_str();

    let auto = AutoLaunchBuilder::new()
      .set_app_name(app_name)
      .set_app_path(app_path)
      .build();

    if let Some(enable) = enable {
      // fix issue #26
      if enable {
        auto.enable()?;
      }
    }

    self.auto_launch = Some(auto);

    Ok(())
  }

  /// update the startup
  pub fn update_launch(&mut self, enable: Option<bool>) -> Result<()> {
    if enable.is_none() {
      return Ok(());
    }

    let enable = enable.unwrap();
    let auto_launch = self.auto_launch.as_ref().unwrap();

    match enable {
      true => auto_launch.enable()?,
      false => auto_launch.disable()?,
    };

    Ok(())
  }

  /// launch a system proxy guard
  /// read config from file directly
  pub fn guard_proxy(&self) {
    use tokio::time::{sleep, Duration};

    let guard_state = self.guard_state.clone();

    tauri::async_runtime::spawn(async move {
      // if it is running, exit
      let mut state = guard_state.lock().await;
      if *state {
        return;
      }
      *state = true;
      drop(state);

      // default duration is 10s
      let mut wait_secs = 10u64;

      loop {
        sleep(Duration::from_secs(wait_secs)).await;

        let verge = Verge::new();

        let enable_proxy = verge.enable_system_proxy.unwrap_or(false);
        let enable_guard = verge.enable_proxy_guard.unwrap_or(false);
        let guard_duration = verge.proxy_guard_duration.unwrap_or(10);

        // update duration
        wait_secs = guard_duration;

        // stop loop
        if !enable_guard || !enable_proxy {
          break;
        }

        log::debug!(target: "app", "try to guard the system proxy");

        let clash = Clash::new();

        match &clash.info.port {
          Some(port) => {
            let bypass = verge.system_proxy_bypass.clone();
            let sysproxy = SysProxyConfig::new(true, port.clone(), bypass);

            log_if_err!(sysproxy.set_sys());
          }
          None => {
            let status = &clash.info.status;
            log::error!(target: "app", "failed to parse clash port with status {status}")
          }
        }
      }

      let mut state = guard_state.lock().await;
      *state = false;
    });
  }
}

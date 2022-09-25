use crate::{data::*, log_if_err};
use anyhow::{anyhow, bail, Result};
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use std::sync::Arc;
use sysproxy::Sysproxy;
use tauri::{async_runtime::Mutex, utils::platform::current_exe};

pub struct Sysopt {
  /// current system proxy setting
  cur_sysproxy: Option<Sysproxy>,

  /// record the original system proxy
  /// recover it when exit
  old_sysproxy: Option<Sysproxy>,

  /// helps to auto launch the app
  auto_launch: Option<AutoLaunch>,

  /// record whether the guard async is running or not
  guard_state: Arc<Mutex<bool>>,
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1/8,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str = "127.0.0.1,localhost,<local>";

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
  pub fn init_sysproxy(&mut self) -> Result<()> {
    let data = Data::global();
    let clash = data.clash.lock();
    let port = clash.info.port.clone();

    if port.is_none() {
      bail!("clash port is none");
    }

    let verge = data.verge.lock();

    let enable = verge.enable_system_proxy.clone().unwrap_or(false);
    let bypass = verge.system_proxy_bypass.clone();
    let bypass = bypass.unwrap_or(DEFAULT_BYPASS.into());

    let port = port.unwrap().parse::<u16>()?;
    let host = String::from("127.0.0.1");

    self.cur_sysproxy = Some(Sysproxy {
      enable,
      host,
      port,
      bypass,
    });

    if enable {
      self.old_sysproxy = Sysproxy::get_system_proxy().map_or(None, |p| Some(p));
      self.cur_sysproxy.as_ref().unwrap().set_system_proxy()?;
    }

    // launchs the system proxy guard
    self.guard_proxy();
    Ok(())
  }

  /// update the system proxy
  pub fn update_sysproxy(&mut self) -> Result<()> {
    if self.cur_sysproxy.is_none() {
      return self.init_sysproxy();
    }

    let data = Data::global();
    let verge = data.verge.lock();

    let enable = verge.enable_system_proxy.clone().unwrap_or(false);
    let bypass = verge.system_proxy_bypass.clone();
    let bypass = bypass.unwrap_or(DEFAULT_BYPASS.into());

    let mut sysproxy = self.cur_sysproxy.take().unwrap();

    sysproxy.enable = enable;
    sysproxy.bypass = bypass;

    self.cur_sysproxy = Some(sysproxy);
    self.cur_sysproxy.as_ref().unwrap().set_system_proxy()?;

    Ok(())
  }

  /// reset the sysproxy
  pub fn reset_sysproxy(&mut self) -> Result<()> {
    if self.cur_sysproxy.is_none() {
      return Ok(());
    }

    let mut cur = self.cur_sysproxy.take().unwrap();

    match self.old_sysproxy.take() {
      Some(old) => {
        // 如果原代理设置和当前的设置是一样的，需要关闭
        // 否则就恢复原代理设置
        if old.enable && old.host == cur.host && old.port == cur.port {
          cur.enable = false;
          cur.set_system_proxy()?;
        } else {
          old.set_system_proxy()?;
        }
      }
      None => {
        if cur.enable {
          cur.enable = false;
          cur.set_system_proxy()?;
        }
      }
    }

    Ok(())
  }

  /// init the auto launch
  pub fn init_launch(&mut self) -> Result<()> {
    let data = Data::global();
    let verge = data.verge.lock();
    let enable = verge.enable_auto_launch.clone().unwrap_or(false);

    let app_exe = current_exe()?;
    let app_exe = dunce::canonicalize(app_exe)?;
    let app_name = app_exe
      .file_stem()
      .and_then(|f| f.to_str())
      .ok_or(anyhow!("failed to get file stem"))?;

    let app_path = app_exe
      .as_os_str()
      .to_str()
      .ok_or(anyhow!("failed to get app_path"))?
      .to_string();

    // fix issue #26
    #[cfg(target_os = "windows")]
    let app_path = format!("\"{app_path}\"");

    // use the /Applications/Clash Verge.app path
    #[cfg(target_os = "macos")]
    let app_path = (|| -> Option<String> {
      let path = std::path::PathBuf::from(&app_path);
      let path = path.parent()?.parent()?.parent()?;
      let extension = path.extension()?.to_str()?;
      match extension == "app" {
        true => Some(path.as_os_str().to_str()?.to_string()),
        false => None,
      }
    })()
    .unwrap_or(app_path);

    let auto = AutoLaunchBuilder::new()
      .set_app_name(app_name)
      .set_app_path(&app_path)
      .build()?;

    self.auto_launch = Some(auto);

    let auto = self.auto_launch.as_ref().unwrap();

    // macos每次启动都更新登录项，避免重复设置登录项
    #[cfg(target_os = "macos")]
    {
      let _ = auto.disable();
      if enable {
        auto.enable()?;
      }
    }

    #[cfg(not(target_os = "macos"))]
    {
      match enable {
        true => auto.enable()?,
        false => auto.disable()?,
      };
    }

    Ok(())
  }

  /// update the startup
  pub fn update_launch(&mut self) -> Result<()> {
    if self.auto_launch.is_none() {
      return self.init_launch();
    }

    let data = Data::global();
    let verge = data.verge.lock();
    let enable = verge.enable_auto_launch.clone().unwrap_or(false);

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

        let global = Data::global();
        let verge = global.verge.lock();

        let enable = verge.enable_system_proxy.clone().unwrap_or(false);
        let guard = verge.enable_proxy_guard.clone().unwrap_or(false);
        let guard_duration = verge.proxy_guard_duration.clone().unwrap_or(10);
        let bypass = verge.system_proxy_bypass.clone();
        drop(verge);

        // stop loop
        if !enable || !guard {
          break;
        }

        // update duration
        wait_secs = guard_duration;

        let clash = global.clash.lock();
        let port = clash.info.port.clone();
        let port = port.unwrap_or("".into()).parse::<u16>();
        drop(clash);

        log::debug!(target: "app", "try to guard the system proxy");

        match port {
          Ok(port) => {
            let sysproxy = Sysproxy {
              enable: true,
              host: "127.0.0.1".into(),
              port,
              bypass: bypass.unwrap_or(DEFAULT_BYPASS.into()),
            };

            log_if_err!(sysproxy.set_system_proxy());
          }
          Err(_) => log::error!(target: "app", "failed to parse clash port"),
        }
      }

      let mut state = guard_state.lock().await;
      *state = false;
    });
  }
}

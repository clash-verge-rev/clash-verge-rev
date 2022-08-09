use self::notice::Notice;
use self::sysopt::Sysopt;
use self::timer::Timer;
use crate::core::enhance::PrfEnhancedResult;
use crate::log_if_err;
use crate::utils::help;
use anyhow::{bail, Result};
use parking_lot::Mutex;
use serde_yaml::Mapping;
use serde_yaml::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, Window};
use tokio::time::sleep;

mod clash;
mod enhance;
mod notice;
mod prfitem;
mod profiles;
mod service;
mod sysopt;
mod timer;
mod verge;

pub use self::clash::*;
pub use self::prfitem::*;
pub use self::profiles::*;
pub use self::service::*;
pub use self::verge::*;

/// close the window for slient start
/// after enhance mode
static mut WINDOW_CLOSABLE: bool = true;

#[derive(Clone)]
pub struct Core {
  pub clash: Arc<Mutex<Clash>>,

  pub verge: Arc<Mutex<Verge>>,

  pub profiles: Arc<Mutex<Profiles>>,

  pub service: Arc<Mutex<Service>>,

  pub sysopt: Arc<Mutex<Sysopt>>,

  pub timer: Arc<Mutex<Timer>>,

  pub window: Arc<Mutex<Option<Window>>>,
}

impl Core {
  pub fn new() -> Core {
    let clash = Clash::new();
    let verge = Verge::new();
    let profiles = Profiles::new();
    let service = Service::new();

    Core {
      clash: Arc::new(Mutex::new(clash)),
      verge: Arc::new(Mutex::new(verge)),
      profiles: Arc::new(Mutex::new(profiles)),
      service: Arc::new(Mutex::new(service)),
      sysopt: Arc::new(Mutex::new(Sysopt::new())),
      timer: Arc::new(Mutex::new(Timer::new())),
      window: Arc::new(Mutex::new(None)),
    }
  }

  /// initialize the core state
  pub fn init(&self, app_handle: tauri::AppHandle) {
    let verge = self.verge.lock();
    let clash_core = verge.clash_core.clone();

    let mut service = self.service.lock();
    service.set_core(clash_core);

    #[cfg(windows)]
    {
      let enable = verge.enable_service_mode.clone();
      service.set_mode(enable.unwrap_or(false));
    }

    log_if_err!(service.start());
    drop(verge);
    drop(service);

    log_if_err!(self.activate());

    let clash = self.clash.lock();
    let verge = self.verge.lock();

    // let silent_start = verge.enable_silent_start.clone();
    let auto_launch = verge.enable_auto_launch.clone();

    // silent start
    // if silent_start.unwrap_or(false) {
    //   let window = self.window.lock();
    //   window.as_ref().map(|win| {
    //     win.hide().unwrap();
    //   });
    // }

    let mut sysopt = self.sysopt.lock();

    sysopt.init_sysproxy(clash.info.port.clone(), &verge);

    drop(clash);
    drop(verge);

    log_if_err!(sysopt.init_launch(auto_launch));

    log_if_err!(self.update_systray(&app_handle));
    log_if_err!(self.update_systray_clash(&app_handle));

    // wait the window setup during resolve app
    let core = self.clone();
    tauri::async_runtime::spawn(async move {
      sleep(Duration::from_secs(2)).await;
      log_if_err!(core.activate_enhanced(true));
    });

    // timer initialize
    let mut timer = self.timer.lock();
    timer.set_core(self.clone());
    log_if_err!(timer.refresh());
  }

  /// save the window instance
  pub fn set_win(&self, win: Option<Window>) {
    let mut window = self.window.lock();
    *window = win;
  }

  /// restart the clash sidecar
  pub fn restart_clash(&self) -> Result<()> {
    let mut service = self.service.lock();
    service.restart()?;
    drop(service);

    self.activate()?;
    self.activate_enhanced(true)
  }

  /// change the clash core
  pub fn change_core(&self, clash_core: Option<String>) -> Result<()> {
    let clash_core = clash_core.unwrap_or("clash".into());

    if &clash_core != "clash" && &clash_core != "clash-meta" {
      bail!("invalid clash core name \"{clash_core}\"");
    }

    let mut verge = self.verge.lock();
    verge.patch_config(Verge {
      clash_core: Some(clash_core.clone()),
      ..Verge::default()
    })?;
    drop(verge);

    let mut service = self.service.lock();
    service.stop()?;
    service.set_core(Some(clash_core));
    service.start()?;
    drop(service);

    self.activate()?;
    self.activate_enhanced(true)
  }

  /// Patch Clash
  /// handle the clash config changed
  pub fn patch_clash(&self, patch: Mapping, app_handle: &AppHandle) -> Result<()> {
    let ((changed_port, changed_mode), port) = {
      let mut clash = self.clash.lock();
      (clash.patch_config(patch)?, clash.info.port.clone())
    };

    // todo: port check

    if changed_port {
      let mut service = self.service.lock();
      service.restart()?;
      drop(service);

      self.activate()?;
      self.activate_enhanced(true)?;

      let mut sysopt = self.sysopt.lock();
      let verge = self.verge.lock();
      sysopt.init_sysproxy(port, &verge);
    }

    if changed_mode {
      self.update_systray_clash(app_handle)?;
    }

    Ok(())
  }

  /// Patch Verge
  pub fn patch_verge(&self, patch: Verge, app_handle: &AppHandle) -> Result<()> {
    let tun_mode = patch.enable_tun_mode.clone();
    let auto_launch = patch.enable_auto_launch.clone();
    let system_proxy = patch.enable_system_proxy.clone();
    let proxy_bypass = patch.system_proxy_bypass.clone();
    let proxy_guard = patch.enable_proxy_guard.clone();

    #[cfg(windows)]
    {
      let service_mode = patch.enable_service_mode.clone();

      if service_mode.is_some() {
        let service_mode = service_mode.unwrap();

        let mut service = self.service.lock();
        service.stop()?;
        service.set_mode(service_mode);
        service.start()?;
        drop(service);

        self.activate_enhanced(false)?;
      }
    }

    if auto_launch.is_some() {
      let mut sysopt = self.sysopt.lock();
      sysopt.update_launch(auto_launch)?;
    }

    if system_proxy.is_some() || proxy_bypass.is_some() {
      let mut sysopt = self.sysopt.lock();
      sysopt.update_sysproxy(system_proxy.clone(), proxy_bypass)?;
      sysopt.guard_proxy();
    }

    if proxy_guard.unwrap_or(false) {
      let sysopt = self.sysopt.lock();
      sysopt.guard_proxy();
    }

    #[cfg(target_os = "windows")]
    if tun_mode.is_some() && *tun_mode.as_ref().unwrap_or(&false) {
      let wintun_dll = crate::utils::dirs::app_home_dir().join("wintun.dll");
      if !wintun_dll.exists() {
        bail!("failed to enable TUN for missing `wintun.dll`");
      }
    }

    // save the patch
    let mut verge = self.verge.lock();
    verge.patch_config(patch)?;
    drop(verge);

    if system_proxy.is_some() || tun_mode.is_some() {
      self.update_systray(app_handle)?;
    }

    if tun_mode.is_some() {
      self.activate_enhanced(false)?;
    }

    Ok(())
  }

  // update system tray state (clash config)
  pub fn update_systray_clash(&self, app_handle: &AppHandle) -> Result<()> {
    let clash = self.clash.lock();
    let mode = clash
      .config
      .get(&Value::from("mode"))
      .map(|val| val.as_str().unwrap_or("rule"))
      .unwrap_or("rule");

    let tray = app_handle.tray_handle();

    tray.get_item("rule_mode").set_selected(mode == "rule")?;
    tray
      .get_item("global_mode")
      .set_selected(mode == "global")?;
    tray
      .get_item("direct_mode")
      .set_selected(mode == "direct")?;
    tray
      .get_item("script_mode")
      .set_selected(mode == "script")?;

    Ok(())
  }

  /// update the system tray state (verge config)
  pub fn update_systray(&self, app_handle: &AppHandle) -> Result<()> {
    let verge = self.verge.lock();
    let tray = app_handle.tray_handle();

    let system_proxy = verge.enable_system_proxy.as_ref();
    let tun_mode = verge.enable_tun_mode.as_ref();

    tray
      .get_item("system_proxy")
      .set_selected(*system_proxy.unwrap_or(&false))?;
    tray
      .get_item("tun_mode")
      .set_selected(*tun_mode.unwrap_or(&false))?;

    // update verge config
    let window = app_handle.get_window("main");
    let notice = Notice::from(window);
    notice.refresh_verge();

    Ok(())
  }

  // update rule/global/direct/script mode
  pub fn update_mode(&self, app_handle: &AppHandle, mode: &str) -> Result<()> {
    // save config to file
    let mut clash = self.clash.lock();
    clash.config.insert(Value::from("mode"), Value::from(mode));
    clash.save_config()?;

    let info = clash.info.clone();
    drop(clash);

    let notice = {
      let window = self.window.lock();
      Notice::from(window.clone())
    };

    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode));

    let service = self.service.lock();
    service.patch_config(info, mapping, notice)?;

    // update tray
    self.update_systray_clash(app_handle)?;

    Ok(())
  }

  /// activate the profile
  /// auto activate enhanced profile
  pub fn activate(&self) -> Result<()> {
    let data = {
      let profiles = self.profiles.lock();
      let data = profiles.gen_activate()?;
      Clash::strict_filter(data)
    };

    let mut clash = self.clash.lock();

    let mut config = clash.config.clone();
    let info = clash.info.clone();

    for (key, value) in data.into_iter() {
      config.insert(key, value);
    }

    let config = {
      let verge = self.verge.lock();
      let tun_mode = verge.enable_tun_mode.unwrap_or(false);
      Clash::_tun_mode(config, tun_mode)
    };

    let notice = {
      let window = self.window.lock();
      Notice::from(window.clone())
    };

    clash.set_running_config(&config);
    drop(clash);

    let service = self.service.lock();
    service.set_config(info, config, notice)
  }

  /// Enhanced
  /// enhanced profiles mode
  pub fn activate_enhanced(&self, skip: bool) -> Result<()> {
    let window = self.window.lock();
    if window.is_none() {
      bail!("failed to get the main window");
    }

    let event_name = help::get_uid("e");
    let event_name = format!("enhanced-cb-{event_name}");

    // generate the payload
    let payload = {
      let profiles = self.profiles.lock();
      profiles.gen_enhanced(event_name.clone())?
    };

    // do not run enhanced
    if payload.chain.len() == 0 {
      if skip {
        return Ok(());
      }

      drop(window);
      return self.activate();
    }

    let tun_mode = {
      let verge = self.verge.lock();
      verge.enable_tun_mode.unwrap_or(false)
    };

    let info = {
      let clash = self.clash.lock();
      clash.info.clone()
    };

    let notice = Notice::from(window.clone());
    let service = self.service.clone();

    let window = window.clone().unwrap();
    window.once(&event_name, move |event| {
      let result = event.payload();

      if result.is_none() {
        log::warn!(target: "app", "event payload result is none");
        return;
      }

      let result = result.unwrap();
      let result: PrfEnhancedResult = serde_json::from_str(result).unwrap();

      if let Some(data) = result.data {
        let mut config = Clash::read_config();
        let filter_data = Clash::loose_filter(data); // loose filter

        for (key, value) in filter_data.into_iter() {
          config.insert(key, value);
        }

        let config = Clash::_tun_mode(config, tun_mode);

        let service = service.lock();
        log_if_err!(service.set_config(info, config, notice));

        log::info!(target: "app", "profile enhanced status {}", result.status);
      }

      result.error.map(|err| log::error!(target: "app", "{err}"));
    });

    let verge = self.verge.lock();
    let silent_start = verge.enable_silent_start.clone();

    let closable = unsafe { WINDOW_CLOSABLE };

    if silent_start.unwrap_or(false) && closable {
      unsafe {
        WINDOW_CLOSABLE = false;
      }

      window.emit("script-handler-close", payload).unwrap();
    } else {
      window.emit("script-handler", payload).unwrap();
    }

    Ok(())
  }
}

impl Core {
  /// Static function
  /// update profile item
  pub async fn update_profile_item(
    core: Core,
    uid: String,
    option: Option<PrfOption>,
  ) -> Result<()> {
    let (url, opt) = {
      let profiles = core.profiles.lock();
      let item = profiles.get_item(&uid)?;

      if let Some(typ) = item.itype.as_ref() {
        // maybe only valid for `local` profile
        if *typ != "remote" {
          // reactivate the config
          if Some(uid) == profiles.get_current() {
            drop(profiles);
            return core.activate_enhanced(false);
          }

          return Ok(());
        }
      }

      if item.url.is_none() {
        bail!("failed to get the profile item url");
      }

      (item.url.clone().unwrap(), item.option.clone())
    };

    let merged_opt = PrfOption::merge(opt, option);
    let item = PrfItem::from_url(&url, None, None, merged_opt).await?;

    let mut profiles = core.profiles.lock();
    profiles.update_item(uid.clone(), item)?;

    // reactivate the profile
    if Some(uid) == profiles.get_current() {
      drop(profiles);
      core.activate_enhanced(false)?;
    }

    Ok(())
  }
}

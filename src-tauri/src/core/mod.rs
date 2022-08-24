use self::notice::Notice;
use self::sysopt::Sysopt;
use self::timer::Timer;
use crate::config::enhance_config;
use crate::log_if_err;
use anyhow::{bail, Result};
use parking_lot::Mutex;
use serde_yaml::Mapping;
use serde_yaml::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Window};

mod clash;
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

#[derive(Clone)]
pub struct Core {
  pub clash: Arc<Mutex<Clash>>,
  pub verge: Arc<Mutex<Verge>>,
  pub profiles: Arc<Mutex<Profiles>>,
  pub service: Arc<Mutex<Service>>,
  pub sysopt: Arc<Mutex<Sysopt>>,
  pub timer: Arc<Mutex<Timer>>,
  pub runtime: Arc<Mutex<RuntimeResult>>,
  pub window: Arc<Mutex<Option<Window>>>,
}

impl Core {
  pub fn new() -> Core {
    Core {
      clash: Arc::new(Mutex::new(Clash::new())),
      verge: Arc::new(Mutex::new(Verge::new())),
      profiles: Arc::new(Mutex::new(Profiles::new())),
      service: Arc::new(Mutex::new(Service::new())),
      sysopt: Arc::new(Mutex::new(Sysopt::new())),
      timer: Arc::new(Mutex::new(Timer::new())),
      runtime: Arc::new(Mutex::new(RuntimeResult::default())),
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
    let mut sysopt = self.sysopt.lock();

    sysopt.init_sysproxy(clash.info.port.clone(), &verge);

    drop(clash);
    drop(verge);

    log_if_err!(sysopt.init_launch(auto_launch));

    log_if_err!(self.update_systray(&app_handle));
    log_if_err!(self.update_systray_clash(&app_handle));

    // timer initialize
    let mut timer = self.timer.lock();
    timer.set_core(self.clone());
    log_if_err!(timer.restore());
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
    self.activate()
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

    self.activate()
  }

  /// Patch Clash
  /// handle the clash config changed
  pub fn patch_clash(&self, patch: Mapping, app_handle: &AppHandle) -> Result<()> {
    let has_port = patch.contains_key(&Value::from("mixed-port"));
    let has_mode = patch.contains_key(&Value::from("mode"));

    let port = {
      let mut clash = self.clash.lock();
      clash.patch_config(patch)?;
      clash.info.port.clone()
    };

    // todo: port check
    if has_port && port.is_some() {
      let mut service = self.service.lock();
      service.restart()?;
      drop(service);

      self.activate()?;

      let mut sysopt = self.sysopt.lock();
      let verge = self.verge.lock();
      sysopt.init_sysproxy(port, &verge);
    }

    if has_mode {
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

        // self.activate_enhanced(false)?;
        self.activate()?;
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
      self.activate()?;
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
    let profile_activate = {
      let profiles = self.profiles.lock();
      profiles.gen_activate()?
    };

    let (clash_config, clash_info) = {
      let clash = self.clash.lock();
      (clash.config.clone(), clash.info.clone())
    };

    let tun_mode = {
      let verge = self.verge.lock();
      verge.enable_tun_mode.unwrap_or(false)
    };

    let (config, exists_keys, logs) = enhance_config(
      clash_config,
      profile_activate.current,
      profile_activate.chain,
      profile_activate.valid,
      tun_mode,
    );

    let mut runtime = self.runtime.lock();
    runtime.config = Some(config.clone());
    runtime.config_yaml = Some(serde_yaml::to_string(&config).unwrap_or("".into()));
    runtime.exists_keys = exists_keys;
    runtime.chain_logs = logs;

    let notice = {
      let window = self.window.lock();
      Notice::from(window.clone())
    };

    let service = self.service.lock();
    service.set_config(clash_info, config, notice)
  }

  /// Static function
  /// update profile item
  pub async fn update_profile_item(&self, uid: String, option: Option<PrfOption>) -> Result<()> {
    let (url, opt) = {
      let profiles = self.profiles.lock();
      let item = profiles.get_item(&uid)?;

      if let Some(typ) = item.itype.as_ref() {
        // maybe only valid for `local` profile
        if *typ != "remote" {
          // reactivate the config
          if Some(uid) == profiles.get_current() {
            drop(profiles);
            return self.activate();
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

    let mut profiles = self.profiles.lock();
    profiles.update_item(uid.clone(), item)?;

    // reactivate the profile
    if Some(uid) == profiles.get_current() {
      drop(profiles);
      self.activate()?;
    }

    Ok(())
  }
}

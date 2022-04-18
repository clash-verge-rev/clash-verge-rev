use self::notice::Notice;
use self::service::Service;
use crate::core::enhance::PrfEnhancedResult;
use crate::log_if_err;
use crate::utils::{config, dirs, help};
use anyhow::{bail, Result};
use serde_yaml::Mapping;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Window;
use tokio::time::sleep;

mod clash;
mod enhance;
mod notice;
mod prfitem;
mod profiles;
mod service;
mod timer;
mod verge;

pub use self::clash::*;
pub use self::prfitem::*;
pub use self::profiles::*;
pub use self::verge::*;

#[derive(Clone)]
pub struct Core {
  pub clash: Arc<Mutex<Clash>>,

  pub verge: Arc<Mutex<Verge>>,

  pub profiles: Arc<Mutex<Profiles>>,

  pub service: Arc<Mutex<Service>>,

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
      window: Arc::new(Mutex::new(None)),
    }
  }

  pub fn init(&self) {
    log_if_err!(self.restart_clash());

    let clash = self.clash.lock().unwrap();
    let mut verge = self.verge.lock().unwrap();
    verge.init_sysproxy(clash.info.port.clone());

    log_if_err!(verge.init_launch());

    // system tray
    // verge.config.enable_system_proxy.map(|enable| {
    //   log_if_err!(app
    //     .tray_handle()
    //     .get_item("system_proxy")
    //     .set_selected(enable));
    // });
  }

  /// save the window instance
  pub fn set_win(&self, win: Option<Window>) {
    let mut window = self.window.lock().unwrap();
    *window = win;
  }

  /// restart the clash sidecar
  pub fn restart_clash(&self) -> Result<()> {
    {
      let mut service = self.service.lock().unwrap();
      service.restart()?;
    }

    self.activate()?;
    self.activate_enhanced(false, true)
  }

  /// handle the clash config changed
  pub fn patch_clash(&self, patch: Mapping) -> Result<()> {
    let (changed, port) = {
      let mut clash = self.clash.lock().unwrap();
      (clash.patch_config(patch)?, clash.info.port.clone())
    };

    // todo: port check

    if changed {
      let mut service = self.service.lock().unwrap();
      service.restart()?;

      self.activate()?;
      self.activate_enhanced(false, true)?;

      let mut verge = self.verge.lock().unwrap();
      verge.init_sysproxy(port);
    }

    Ok(())
  }

  /// activate the profile
  /// auto activate enhanced profile
  pub fn activate(&self) -> Result<()> {
    let data = {
      let profiles = self.profiles.lock().unwrap();
      let data = profiles.gen_activate()?;
      Clash::strict_filter(data)
    };

    let (mut config, info) = {
      let clash = self.clash.lock().unwrap();
      let config = clash.config.clone();
      let info = clash.info.clone();
      (config, info)
    };

    for (key, value) in data.into_iter() {
      config.insert(key, value);
    }

    let config = {
      let verge = self.verge.lock().unwrap();
      let tun_mode = verge.config.enable_tun_mode.unwrap_or(false);
      Clash::_tun_mode(config, tun_mode)
    };

    let notice = {
      let window = self.window.lock().unwrap();
      Notice::from(window.clone())
    };

    let service = self.service.lock().unwrap();
    service.set_config(info, config, notice)
  }

  /// enhanced profiles mode
  pub fn activate_enhanced(&self, delay: bool, skip: bool) -> Result<()> {
    let window = self.window.lock().unwrap();
    if window.is_none() {
      bail!("failed to get the main window");
    }

    let event_name = help::get_uid("e");
    let event_name = format!("enhanced-cb-{event_name}");

    // generate the payload
    let payload = {
      let profiles = self.profiles.lock().unwrap();
      profiles.gen_enhanced(event_name.clone())?
    };

    // do not run enhanced
    if payload.chain.len() == 0 {
      if skip {
        return Ok(());
      }

      return self.activate();
    }

    let tun_mode = {
      let verge = self.verge.lock().unwrap();
      verge.config.enable_tun_mode.unwrap_or(false)
    };

    let info = {
      let clash = self.clash.lock().unwrap();
      clash.info.clone()
    };

    let notice = Notice::from(window.clone());
    let service = self.service.clone();

    let window = window.clone().unwrap();
    window.once(&event_name, move |event| {
      let result = event.payload();

      if result.is_none() {
        log::warn!("event payload result is none");
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

        let service = service.lock().unwrap();
        log_if_err!(service.set_config(info, config, notice));

        log::info!("profile enhanced status {}", result.status);
      }

      result.error.map(|err| log::error!("{err}"));
    });

    // wait the window setup during resolve app
    // if delay {
    //   sleep(Duration::from_secs(2)).await;
    // }

    window.emit("script-handler", payload).unwrap();

    Ok(())
  }
}

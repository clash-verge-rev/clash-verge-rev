use self::notice::Notice;
use self::service::Service;
use crate::core::enhance::PrfEnhancedResult;
use crate::log_if_err;
use crate::utils::help;
use anyhow::{bail, Result};
use parking_lot::Mutex;
use serde_yaml::Mapping;
use std::sync::Arc;
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

  pub fn init(&self, app_handle: tauri::AppHandle) {
    let mut service = self.service.lock();
    log_if_err!(service.start());
    drop(service);

    log_if_err!(self.activate());

    let clash = self.clash.lock();
    let mut verge = self.verge.lock();

    let hide = verge.config.enable_silent_start.clone().unwrap_or(false);

    // silent start
    if hide {
      let window = self.window.lock();
      window.as_ref().map(|win| {
        win.hide().unwrap();
      });
    }

    verge.init_sysproxy(clash.info.port.clone());

    log_if_err!(verge.init_launch());
    log_if_err!(verge.update_systray(&app_handle));

    drop(clash);
    drop(verge);

    // wait the window setup during resolve app
    let core = self.clone();
    tauri::async_runtime::spawn(async move {
      sleep(Duration::from_secs(2)).await;
      log_if_err!(core.activate_enhanced(true));
    });
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

  /// handle the clash config changed
  pub fn patch_clash(&self, patch: Mapping) -> Result<()> {
    let (changed, port) = {
      let mut clash = self.clash.lock();
      (clash.patch_config(patch)?, clash.info.port.clone())
    };

    // todo: port check

    if changed {
      let mut service = self.service.lock();
      service.restart()?;
      drop(service);

      self.activate()?;
      self.activate_enhanced(true)?;

      let mut verge = self.verge.lock();
      verge.init_sysproxy(port);
    }

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

    let (mut config, info) = {
      let clash = self.clash.lock();
      let config = clash.config.clone();
      let info = clash.info.clone();
      (config, info)
    };

    for (key, value) in data.into_iter() {
      config.insert(key, value);
    }

    let config = {
      let verge = self.verge.lock();
      let tun_mode = verge.config.enable_tun_mode.unwrap_or(false);
      Clash::_tun_mode(config, tun_mode)
    };

    let notice = {
      let window = self.window.lock();
      Notice::from(window.clone())
    };

    let service = self.service.lock();
    service.set_config(info, config, notice)
  }

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
      verge.config.enable_tun_mode.unwrap_or(false)
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

        let service = service.lock();
        log_if_err!(service.set_config(info, config, notice));

        log::info!("profile enhanced status {}", result.status);
      }

      result.error.map(|err| log::error!("{err}"));
    });

    // if delay {
    //   sleep(Duration::from_secs(2)).await;
    // }

    window.emit("script-handler", payload).unwrap();

    Ok(())
  }
}

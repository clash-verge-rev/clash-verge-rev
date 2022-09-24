use crate::data::*;
use crate::log_if_err;
use anyhow::{bail, Result};
use serde_yaml::Value;
use tauri::{AppHandle, Manager, Window};

#[derive(Debug, Default, Clone)]
pub struct Handle {
  pub app_handle: Option<AppHandle>,
}

impl Handle {
  pub fn set_inner(&mut self, app_handle: AppHandle) {
    self.app_handle = Some(app_handle);
  }

  pub fn get_window(&self) -> Option<Window> {
    self
      .app_handle
      .as_ref()
      .map_or(None, |a| a.get_window("main"))
  }

  pub fn refresh_clash(&self) {
    if let Some(window) = self.get_window() {
      log_if_err!(window.emit("verge://refresh-clash-config", "yes"));
    }
  }

  pub fn refresh_verge(&self) {
    if let Some(window) = self.get_window() {
      log_if_err!(window.emit("verge://refresh-verge-config", "yes"));
    }
  }

  #[allow(unused)]
  pub fn refresh_profiles(&self) {
    if let Some(window) = self.get_window() {
      log_if_err!(window.emit("verge://refresh-profiles-config", "yes"));
    }
  }

  // update system tray state (clash config)
  pub fn update_systray_clash(&self) -> Result<()> {
    if self.app_handle.is_none() {
      bail!("update_systray_clash unhandle error");
    }

    let app_handle = self.app_handle.as_ref().unwrap();

    let global = Data::global();
    let clash = global.clash.lock();
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
  pub fn update_systray(&self) -> Result<()> {
    if self.app_handle.is_none() {
      bail!("update_systray unhandle error");
    }

    let app_handle = self.app_handle.as_ref().unwrap();
    let tray = app_handle.tray_handle();

    let global = Data::global();
    let verge = global.verge.lock();
    let system_proxy = verge.enable_system_proxy.as_ref();
    let tun_mode = verge.enable_tun_mode.as_ref();

    tray
      .get_item("system_proxy")
      .set_selected(*system_proxy.unwrap_or(&false))?;
    tray
      .get_item("tun_mode")
      .set_selected(*tun_mode.unwrap_or(&false))?;

    // update verge config
    self.refresh_verge();

    Ok(())
  }
}

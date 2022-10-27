use super::tray::Tray;
use crate::log_if_err;
use anyhow::{bail, Result};
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

  pub fn notice_message(&self, status: String, msg: String) {
    if let Some(window) = self.get_window() {
      log_if_err!(window.emit("verge://notice-message", (status, msg)));
    }
  }

  pub fn update_systray(&self) -> Result<()> {
    if self.app_handle.is_none() {
      bail!("update_systray unhandle error");
    }
    let app_handle = self.app_handle.as_ref().unwrap();
    Tray::update_systray(app_handle)?;
    Ok(())
  }

  /// update the system tray state
  pub fn update_systray_part(&self) -> Result<()> {
    if self.app_handle.is_none() {
      bail!("update_systray unhandle error");
    }
    let app_handle = self.app_handle.as_ref().unwrap();
    Tray::update_part(app_handle)?;
    Ok(())
  }
}

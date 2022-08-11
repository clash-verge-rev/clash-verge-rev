use crate::log_if_err;
use tauri::Window;

#[derive(Debug, Default, Clone)]
pub struct Notice {
  win: Option<Window>,
}

impl Notice {
  pub fn from(win: Option<Window>) -> Notice {
    Notice { win }
  }

  #[allow(unused)]
  pub fn set_win(&mut self, win: Option<Window>) {
    self.win = win;
  }

  pub fn refresh_clash(&self) {
    if let Some(window) = self.win.as_ref() {
      log_if_err!(window.emit("verge://refresh-clash-config", "yes"));
    }
  }

  pub fn refresh_verge(&self) {
    if let Some(window) = self.win.as_ref() {
      log_if_err!(window.emit("verge://refresh-verge-config", "yes"));
    }
  }

  #[allow(unused)]
  pub fn refresh_profiles(&self) {
    if let Some(window) = self.win.as_ref() {
      log_if_err!(window.emit("verge://refresh-profiles-config", "yes"));
    }
  }
}

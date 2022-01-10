use crate::utils::{config, dirs, startup, sysopt::SysProxyConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::api::path::resource_dir;

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeConfig {
  /// `light` or `dark`
  pub theme_mode: Option<String>,

  /// can the app auto startup
  pub enable_self_startup: Option<bool>,

  /// set system proxy
  pub enable_system_proxy: Option<bool>,

  /// set system proxy bypass
  pub system_proxy_bypass: Option<String>,
}

static VERGE_CONFIG: &str = "verge.yaml";

impl VergeConfig {
  pub fn new() -> Self {
    config::read_yaml::<VergeConfig>(dirs::app_home_dir().join(VERGE_CONFIG))
  }

  /// Save Verge App Config
  pub fn save_file(&self) -> Result<(), String> {
    config::save_yaml(
      dirs::app_home_dir().join(VERGE_CONFIG),
      self,
      Some("# The Config for Clash Verge App\n\n"),
    )
  }
}

/// Verge App abilities
#[derive(Debug)]
pub struct Verge {
  pub config: VergeConfig,

  pub old_sysproxy: Option<SysProxyConfig>,

  pub cur_sysproxy: Option<SysProxyConfig>,

  pub exe_path: Option<PathBuf>,
}

impl Default for Verge {
  fn default() -> Self {
    Verge::new()
  }
}

impl Verge {
  pub fn new() -> Self {
    Verge {
      config: VergeConfig::new(),
      old_sysproxy: None,
      cur_sysproxy: None,
      exe_path: None,
    }
  }

  /// init the sysproxy
  pub fn init_sysproxy(&mut self, port: Option<String>) {
    if let Some(port) = port {
      let enable = self.config.enable_system_proxy.clone().unwrap_or(false);

      self.old_sysproxy = match SysProxyConfig::get_sys() {
        Ok(proxy) => Some(proxy),
        Err(_) => None,
      };

      let bypass = self.config.system_proxy_bypass.clone();
      let sysproxy = SysProxyConfig::new(enable, port, bypass);

      if enable {
        if sysproxy.set_sys().is_err() {
          log::error!("failed to set system proxy");
        }
      }

      self.cur_sysproxy = Some(sysproxy);
    }
  }

  /// reset the sysproxy
  pub fn reset_sysproxy(&mut self) {
    if let Some(sysproxy) = self.old_sysproxy.take() {
      match sysproxy.set_sys() {
        Ok(_) => self.cur_sysproxy = None,
        Err(_) => log::error!("failed to reset proxy for"),
      }
    }
  }

  /// set the exe_path
  pub fn set_exe_path(&mut self, package_info: &tauri::PackageInfo) {
    let exe = if cfg!(target_os = "windows") {
      "clash-verge.exe"
    } else {
      "clash-verge"
    };
    let path = resource_dir(package_info).unwrap().join(exe);
    self.exe_path = Some(path);
  }

  /// sync the startup when run the app
  pub fn sync_startup(&self) -> Result<(), String> {
    let enable = self.config.enable_self_startup.clone().unwrap_or(false);

    if !enable {
      return Ok(());
    }
    if self.exe_path.is_none() {
      return Err("should init the exe_path first".into());
    }

    let exe_path = self.exe_path.clone().unwrap();
    match startup::get_startup(&exe_path) {
      Ok(sys_enable) => {
        if sys_enable || (!sys_enable && startup::set_startup(true, &exe_path).is_ok()) {
          Ok(())
        } else {
          Err("failed to sync startup".into())
        }
      }
      Err(_) => Err("failed to get system startup info".into()),
    }
  }

  /// update the startup
  fn update_startup(&mut self, enable: bool) -> Result<(), String> {
    let conf_enable = self.config.enable_self_startup.clone().unwrap_or(false);

    if enable == conf_enable {
      return Ok(());
    }
    if self.exe_path.is_none() {
      return Err("should init the exe_path first".into());
    }
    let exe_path = self.exe_path.clone().unwrap();
    match startup::set_startup(enable, &exe_path) {
      Ok(_) => Ok(()),
      Err(_) => Err("failed to set system startup info".into()),
    }
  }

  /// patch verge config
  /// There should be only one update at a time here
  /// so call the save_file at the end is savely
  pub fn patch_config(&mut self, patch: VergeConfig) -> Result<(), String> {
    // only change it
    if patch.theme_mode.is_some() {
      self.config.theme_mode = patch.theme_mode;
    }

    // should update system startup
    if patch.enable_self_startup.is_some() {
      let enable = patch.enable_self_startup.unwrap();
      self.update_startup(enable)?;
      self.config.enable_self_startup = Some(enable);
    }

    // should update system proxy
    if patch.enable_system_proxy.is_some() {
      let enable = patch.enable_system_proxy.unwrap();
      if let Some(mut sysproxy) = self.cur_sysproxy.take() {
        sysproxy.enable = enable;
        if sysproxy.set_sys().is_err() {
          log::error!("failed to set system proxy");
          return Err("failed to set system proxy".into());
        }
        self.cur_sysproxy = Some(sysproxy);
      }
      self.config.enable_system_proxy = Some(enable);
    }

    // todo
    // should update system proxt too
    if patch.system_proxy_bypass.is_some() {
      self.config.system_proxy_bypass = patch.system_proxy_bypass;
    }

    self.config.save_file()
  }
}

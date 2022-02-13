use crate::utils::{config, dirs, sysopt::SysProxyConfig};
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use serde::{Deserialize, Serialize};
use tauri::api::path::resource_dir;

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeConfig {
  /// `light` or `dark`
  pub theme_mode: Option<String>,

  /// enable blur mode
  /// maybe be able to set the alpha
  pub theme_blur: Option<bool>,

  /// can the app auto startup
  pub enable_auto_launch: Option<bool>,

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

  pub auto_launch: Option<AutoLaunch>,
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
      auto_launch: None,
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

  /// init the auto launch
  pub fn init_launch(&mut self, package_info: &tauri::PackageInfo) {
    let app_name = "clash-verge";
    let app_path = get_app_path(app_name);
    let app_path = resource_dir(package_info, &tauri::Env::default())
      .unwrap()
      .join(app_path);
    let app_path = app_path.as_os_str().to_str().unwrap();

    let auto = AutoLaunchBuilder::new()
      .set_app_name(app_name)
      .set_app_path(app_path)
      .build();

    self.auto_launch = Some(auto);
  }

  /// sync the startup when run the app
  pub fn sync_launch(&self) -> Result<(), String> {
    let enable = self.config.enable_auto_launch.clone().unwrap_or(false);
    if !enable {
      return Ok(());
    }

    if self.auto_launch.is_none() {
      return Err("should init the auto launch first".into());
    }

    let auto_launch = self.auto_launch.clone().unwrap();

    let is_enabled = auto_launch.is_enabled().unwrap_or(false);
    if !is_enabled {
      if let Err(_) = auto_launch.enable() {
        return Err("failed to enable auto-launch".into());
      }
    }

    Ok(())
  }

  /// update the startup
  fn update_launch(&mut self, enable: bool) -> Result<(), String> {
    let conf_enable = self.config.enable_auto_launch.clone().unwrap_or(false);

    if enable == conf_enable {
      return Ok(());
    }

    let auto_launch = self.auto_launch.clone().unwrap();

    let result = if enable {
      auto_launch.enable()
    } else {
      auto_launch.disable()
    };

    match result {
      Ok(_) => Ok(()),
      Err(err) => {
        log::error!("{err}");
        Err("failed to set system startup info".into())
      }
    }
  }

  // fn guard_thread(&mut self) -> Result<(), String> {
  //   let sysproxy = self.cur_sysproxy.clone();

  //   use std::{thread, time};
  //   tauri::async_runtime::spawn(async move {
  //     if let Some(sysproxy) = sysproxy {
  //       sysproxy.set_sys();
  //     }

  //     let ten_millis = time::Duration::from_millis(10);
  //     let now = time::Instant::now();

  //     thread::sleep(ten_millis);
  //   });

  //   Ok(())
  // }

  /// patch verge config
  /// There should be only one update at a time here
  /// so call the save_file at the end is savely
  pub fn patch_config(&mut self, patch: VergeConfig) -> Result<(), String> {
    // only change it
    if patch.theme_mode.is_some() {
      self.config.theme_mode = patch.theme_mode;
    }
    if patch.theme_blur.is_some() {
      self.config.theme_blur = patch.theme_blur;
    }

    // should update system startup
    if patch.enable_auto_launch.is_some() {
      let enable = patch.enable_auto_launch.unwrap();
      self.update_launch(enable)?;
      self.config.enable_auto_launch = Some(enable);
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
    // should update system proxy too
    if patch.system_proxy_bypass.is_some() {
      self.config.system_proxy_bypass = patch.system_proxy_bypass;
    }

    self.config.save_file()
  }
}

// Get the target app_path
fn get_app_path(app_name: &str) -> String {
  #[cfg(target_os = "linux")]
  let ext = "";
  #[cfg(target_os = "macos")]
  let ext = "";
  #[cfg(target_os = "windows")]
  let ext = ".exe";
  String::from(app_name) + ext
}

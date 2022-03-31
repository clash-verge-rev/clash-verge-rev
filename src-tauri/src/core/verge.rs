use crate::log_if_err;
use crate::{
  core::Clash,
  utils::{config, dirs, sysopt::SysProxyConfig},
};
use anyhow::{bail, Result};
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{async_runtime::Mutex, utils::platform::current_exe};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeConfig {
  // i18n
  pub language: Option<String>,

  /// `light` or `dark`
  pub theme_mode: Option<String>,

  /// enable blur mode
  /// maybe be able to set the alpha
  pub theme_blur: Option<bool>,

  /// enable traffic graph default is true
  pub traffic_graph: Option<bool>,

  /// clash tun mode
  pub enable_tun_mode: Option<bool>,

  /// can the app auto startup
  pub enable_auto_launch: Option<bool>,

  /// not show the window on launch
  pub enable_silent_start: Option<bool>,

  /// set system proxy
  pub enable_system_proxy: Option<bool>,

  /// enable proxy guard
  pub enable_proxy_guard: Option<bool>,

  /// set system proxy bypass
  pub system_proxy_bypass: Option<String>,

  /// proxy guard duration
  pub proxy_guard_duration: Option<u64>,

  /// theme setting
  pub theme_setting: Option<VergeTheme>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeTheme {
  pub primary_color: Option<String>,
  pub secondary_color: Option<String>,
  pub info_color: Option<String>,
  pub error_color: Option<String>,
  pub warning_color: Option<String>,
  pub success_color: Option<String>,

  pub font_family: Option<String>,
  pub font_face: Option<String>,
}

impl VergeConfig {
  pub fn new() -> Self {
    config::read_yaml::<VergeConfig>(dirs::verge_path())
  }

  /// Save Verge App Config
  pub fn save_file(&self) -> Result<()> {
    config::save_yaml(
      dirs::verge_path(),
      self,
      Some("# The Config for Clash Verge App\n\n"),
    )
  }
}

/// Verge App abilities
#[derive(Debug)]
pub struct Verge {
  /// manage the verge config
  pub config: VergeConfig,

  /// current system proxy setting
  pub cur_sysproxy: Option<SysProxyConfig>,

  /// record the original system proxy
  /// recover it when exit
  old_sysproxy: Option<SysProxyConfig>,

  /// helps to auto launch the app
  auto_launch: Option<AutoLaunch>,

  /// record whether the guard async is running or not
  guard_state: Arc<Mutex<bool>>,
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
      guard_state: Arc::new(Mutex::new(false)),
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

    // launchs the system proxy guard
    Verge::guard_proxy(self.guard_state.clone());
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
  pub fn init_launch(&mut self) -> Result<()> {
    let app_exe = current_exe().unwrap();
    let app_exe = dunce::canonicalize(app_exe).unwrap();
    let app_name = app_exe.file_stem().unwrap().to_str().unwrap();
    let app_path = app_exe.as_os_str().to_str().unwrap();

    // fix issue #26
    #[cfg(target_os = "windows")]
    let app_path = format!("\"{app_path}\"");
    #[cfg(target_os = "windows")]
    let app_path = app_path.as_str();

    let auto = AutoLaunchBuilder::new()
      .set_app_name(app_name)
      .set_app_path(app_path)
      .build();

    if let Some(enable) = self.config.enable_auto_launch.as_ref() {
      // fix issue #26
      if *enable {
        auto.enable()?;
      }
    }

    self.auto_launch = Some(auto);

    Ok(())
  }

  /// update the startup
  fn update_launch(&mut self, enable: bool) -> Result<()> {
    let conf_enable = self.config.enable_auto_launch.clone().unwrap_or(false);

    if enable == conf_enable {
      return Ok(());
    }

    let auto_launch = self.auto_launch.clone().unwrap();

    match enable {
      true => auto_launch.enable()?,
      false => auto_launch.disable()?,
    };

    Ok(())
  }

  /// patch verge config
  /// There should be only one update at a time here
  /// so call the save_file at the end is savely
  pub fn patch_config(&mut self, patch: VergeConfig) -> Result<()> {
    // only change it
    if patch.language.is_some() {
      self.config.language = patch.language;
    }
    if patch.theme_mode.is_some() {
      self.config.theme_mode = patch.theme_mode;
    }
    if patch.theme_blur.is_some() {
      self.config.theme_blur = patch.theme_blur;
    }
    if patch.traffic_graph.is_some() {
      self.config.traffic_graph = patch.traffic_graph;
    }
    if patch.enable_silent_start.is_some() {
      self.config.enable_silent_start = patch.enable_silent_start;
    }
    if patch.theme_setting.is_some() {
      self.config.theme_setting = patch.theme_setting;
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
          self.cur_sysproxy = Some(sysproxy);

          log::error!("failed to set system proxy");
          bail!("failed to set system proxy");
        }
        self.cur_sysproxy = Some(sysproxy);
      }
      self.config.enable_system_proxy = Some(enable);
    }

    // should update system proxy too
    if patch.system_proxy_bypass.is_some() {
      let bypass = patch.system_proxy_bypass.unwrap();

      if let Some(mut sysproxy) = self.cur_sysproxy.take() {
        if sysproxy.enable {
          sysproxy.bypass = bypass.clone();

          if sysproxy.set_sys().is_err() {
            self.cur_sysproxy = Some(sysproxy);

            log::error!("failed to set system proxy");
            bail!("failed to set system proxy");
          }
        }

        self.cur_sysproxy = Some(sysproxy);
      }

      self.config.system_proxy_bypass = Some(bypass);
    }

    // proxy guard
    // only change it
    if patch.enable_proxy_guard.is_some() {
      self.config.enable_proxy_guard = patch.enable_proxy_guard;
    }
    if patch.proxy_guard_duration.is_some() {
      self.config.proxy_guard_duration = patch.proxy_guard_duration;
    }

    // relaunch the guard
    if patch.enable_system_proxy.is_some() || patch.enable_proxy_guard.is_some() {
      Verge::guard_proxy(self.guard_state.clone());
    }

    // handle the tun mode
    if patch.enable_tun_mode.is_some() {
      self.config.enable_tun_mode = patch.enable_tun_mode;
    }

    self.config.save_file()
  }
}

impl Verge {
  /// launch a system proxy guard
  /// read config from file directly
  pub fn guard_proxy(guard_state: Arc<Mutex<bool>>) {
    use tokio::time::{sleep, Duration};

    tauri::async_runtime::spawn(async move {
      // if it is running, exit
      let mut state = guard_state.lock().await;
      if *state {
        return;
      }
      *state = true;
      std::mem::drop(state);

      // default duration is 10s
      let mut wait_secs = 10u64;

      loop {
        sleep(Duration::from_secs(wait_secs)).await;

        log::debug!("guard heartbeat detection");

        let verge = Verge::new();

        let enable_proxy = verge.config.enable_system_proxy.unwrap_or(false);
        let enable_guard = verge.config.enable_proxy_guard.unwrap_or(false);
        let guard_duration = verge.config.proxy_guard_duration.unwrap_or(10);

        // update duration
        wait_secs = guard_duration;

        // stop loop
        if !enable_guard || !enable_proxy {
          break;
        }

        log::info!("try to guard proxy");

        let clash = Clash::new();

        match &clash.info.port {
          Some(port) => {
            let bypass = verge.config.system_proxy_bypass.clone();
            let sysproxy = SysProxyConfig::new(true, port.clone(), bypass);

            log_if_err!(sysproxy.set_sys());
          }
          None => log::error!("fail to parse clash port"),
        }
      }

      let mut state = guard_state.lock().await;
      *state = false;
    });
  }
}

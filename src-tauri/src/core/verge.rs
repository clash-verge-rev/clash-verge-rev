use crate::utils::{config, dirs, sysopt::SysProxyConfig};
use serde::{Deserialize, Serialize};

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

#[derive(Debug)]
pub struct Verge {
  pub config: VergeConfig,

  pub old_sysproxy: Option<SysProxyConfig>,

  pub cur_sysproxy: Option<SysProxyConfig>,
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
}

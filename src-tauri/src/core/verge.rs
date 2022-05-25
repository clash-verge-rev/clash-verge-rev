use crate::utils::{config, dirs};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct Verge {
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

  /// windows service mode
  #[serde(skip_serializing_if = "Option::is_none")]
  pub enable_service_mode: Option<bool>,

  /// can the app auto startup
  pub enable_auto_launch: Option<bool>,

  /// not show the window on launch
  pub enable_silent_start: Option<bool>,

  /// set system proxy
  pub enable_system_proxy: Option<bool>,

  /// enable proxy guard
  pub enable_proxy_guard: Option<bool>,

  /// launch flag
  #[serde(skip_serializing)]
  pub launch_flag: Option<bool>,

  /// set system proxy bypass
  pub system_proxy_bypass: Option<String>,

  /// proxy guard duration
  pub proxy_guard_duration: Option<u64>,

  /// theme setting
  pub theme_setting: Option<VergeTheme>,

  /// clash core path
  #[serde(skip_serializing_if = "Option::is_none")]
  pub clash_core: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct VergeTheme {
  pub primary_color: Option<String>,
  pub secondary_color: Option<String>,
  pub primary_text: Option<String>,
  pub secondary_text: Option<String>,

  pub info_color: Option<String>,
  pub error_color: Option<String>,
  pub warning_color: Option<String>,
  pub success_color: Option<String>,

  pub font_family: Option<String>,
  pub css_injection: Option<String>,
}

impl Verge {
  pub fn new() -> Self {
    config::read_yaml::<Verge>(dirs::verge_path())
  }

  /// Save Verge App Config
  pub fn save_file(&self) -> Result<()> {
    config::save_yaml(
      dirs::verge_path(),
      self,
      Some("# The Config for Clash Verge App\n\n"),
    )
  }

  /// patch verge config
  /// only save to file
  pub fn patch_config(&mut self, patch: Verge) -> Result<()> {
    // only change it
    if patch.language.is_some() {
      self.language = patch.language;
    }
    if patch.theme_mode.is_some() {
      self.theme_mode = patch.theme_mode;
    }
    if patch.theme_blur.is_some() {
      self.theme_blur = patch.theme_blur;
    }
    if patch.theme_setting.is_some() {
      self.theme_setting = patch.theme_setting;
    }
    if patch.traffic_graph.is_some() {
      self.traffic_graph = patch.traffic_graph;
    }
    if patch.clash_core.is_some() {
      self.clash_core = patch.clash_core;
    }

    // system setting
    if patch.enable_silent_start.is_some() {
      self.enable_silent_start = patch.enable_silent_start;
    }
    if patch.enable_auto_launch.is_some() {
      self.enable_auto_launch = patch.enable_auto_launch;
    }

    // proxy
    if patch.enable_system_proxy.is_some() {
      self.enable_system_proxy = patch.enable_system_proxy;
    }
    if patch.system_proxy_bypass.is_some() {
      self.system_proxy_bypass = patch.system_proxy_bypass;
    }
    if patch.enable_proxy_guard.is_some() {
      self.enable_proxy_guard = patch.enable_proxy_guard;
    }
    if patch.proxy_guard_duration.is_some() {
      self.proxy_guard_duration = patch.proxy_guard_duration;
    }

    // tun mode
    if patch.enable_tun_mode.is_some() {
      self.enable_tun_mode = patch.enable_tun_mode;
    }
    if patch.enable_service_mode.is_some() {
      self.enable_service_mode = patch.enable_service_mode;
    }

    self.save_file()
  }
}

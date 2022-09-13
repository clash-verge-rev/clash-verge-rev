use crate::utils::{config, dirs};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// ### `verge.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct Verge {
  /// app listening port
  /// for app singleton
  pub app_singleton_port: Option<u16>,

  // i18n
  pub language: Option<String>,

  /// `light` or `dark` or `system`
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

  /// set system proxy bypass
  pub system_proxy_bypass: Option<String>,

  /// proxy guard duration
  pub proxy_guard_duration: Option<u64>,

  /// theme setting
  pub theme_setting: Option<VergeTheme>,

  /// web ui list
  pub web_ui_list: Option<Vec<String>>,

  /// clash core path
  #[serde(skip_serializing_if = "Option::is_none")]
  pub clash_core: Option<String>,

  /// hotkey map
  /// format: {func},{key}
  pub hotkeys: Option<Vec<String>>,
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
    macro_rules! patch {
      ($key: tt) => {
        if patch.$key.is_some() {
          self.$key = patch.$key;
        }
      };
    }

    patch!(language);
    patch!(theme_mode);
    patch!(theme_blur);
    patch!(traffic_graph);

    patch!(enable_tun_mode);
    patch!(enable_service_mode);
    patch!(enable_auto_launch);
    patch!(enable_silent_start);
    patch!(enable_system_proxy);
    patch!(enable_proxy_guard);
    patch!(system_proxy_bypass);
    patch!(proxy_guard_duration);

    patch!(theme_setting);
    patch!(web_ui_list);
    patch!(clash_core);
    patch!(hotkeys);

    self.save_file()
  }
}

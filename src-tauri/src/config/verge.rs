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

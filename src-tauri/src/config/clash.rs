use serde::{Deserialize, Serialize};

/// ### `config.yaml` schema
/// here should contain all configuration options.
/// See: https://github.com/Dreamacro/clash/wiki/configuration for details
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashConfig {
  pub port: Option<u32>,

  /// alias to `mixed-port`
  pub mixed_port: Option<u32>,

  /// alias to `allow-lan`
  pub allow_lan: Option<bool>,

  /// alias to `external-controller`
  pub external_ctrl: Option<String>,

  pub secret: Option<String>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashController {
  /// clash core port
  pub port: Option<String>,

  /// same as `external-controller`
  pub server: Option<String>,
  pub secret: Option<String>,
}

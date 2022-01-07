use serde::{Deserialize, Serialize};
use std::io;

static DEFAULT_BYPASS: &str = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SysProxyConfig {
  pub enable: bool,
  pub server: String,
  pub bypass: String,
}

impl Default for SysProxyConfig {
  fn default() -> Self {
    SysProxyConfig {
      enable: false,
      server: String::from(""),
      bypass: String::from(""),
    }
  }
}

impl SysProxyConfig {
  pub fn new(enable: bool, port: String, bypass: Option<String>) -> Self {
    SysProxyConfig {
      enable,
      server: format!("127.0.0.1:{}", port),
      bypass: bypass.unwrap_or(DEFAULT_BYPASS.into()),
    }
  }

  /// Get the windows system proxy config
  #[cfg(target_os = "windows")]
  pub fn get_sys() -> io::Result<Self> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cur_var = hkcu.open_subkey_with_flags(
      "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      KEY_READ,
    )?;

    Ok(SysProxyConfig {
      enable: cur_var.get_value::<u32, _>("ProxyEnable")? == 1u32,
      server: cur_var.get_value("ProxyServer")?,
      bypass: cur_var.get_value("ProxyOverride")?,
    })
  }

  #[cfg(target_os = "windows")]
  /// Set the windows system proxy config
  pub fn set_sys(&self) -> io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cur_var = hkcu.open_subkey_with_flags(
      "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      KEY_SET_VALUE,
    )?;

    let enable: u32 = if self.enable { 1u32 } else { 0u32 };

    cur_var.set_value("ProxyEnable", &enable)?;
    cur_var.set_value("ProxyServer", &self.server)?;
    cur_var.set_value("ProxyOverride", &self.bypass)
  }
}

// #[cfg(target_os = "macos")]
// mod macos {
//   use super::*;

//   pub fn get_proxy_config() -> io::Result<SysProxyConfig> {
//     Ok(SysProxyConfig {
//       enable: false,
//       server: "server".into(),
//       bypass: "bypass".into(),
//     })
//   }

//   pub fn set_proxy_config(config: &SysProxyConfig) -> io::Result<()> {
//     Ok(())
//   }
// }

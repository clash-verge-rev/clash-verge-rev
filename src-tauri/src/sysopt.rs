use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Debug, Deserialize, Serialize)]
pub struct ProxyConfig {
  enable: u32,
  server: String,
  bypass: String,
}

#[cfg(target_os = "windows")]
/// Get the windows system proxy config
pub fn get_proxy_config() -> io::Result<ProxyConfig> {
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let cur_var = hkcu.open_subkey_with_flags(
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    KEY_READ,
  )?;

  Ok(ProxyConfig {
    enable: cur_var.get_value("ProxyEnable")?,
    server: cur_var.get_value("ProxyServer")?,
    bypass: cur_var.get_value("ProxyOverride")?,
  })
}

#[cfg(target_os = "windows")]
/// Set the windows system proxy config
pub fn set_proxy_config(config: &ProxyConfig) -> io::Result<()> {
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let cur_var = hkcu.open_subkey_with_flags(
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    KEY_SET_VALUE,
  )?;

  cur_var.set_value("ProxyEnable", &config.enable)?;
  cur_var.set_value("ProxyServer", &config.server)?;
  cur_var.set_value("ProxyOverride", &config.bypass)?;

  Ok(())
}

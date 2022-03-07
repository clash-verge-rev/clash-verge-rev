use serde::{Deserialize, Serialize};
use std::io;

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1/8,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
  "192.168.0.0/16\n10.0.0.0/8\n172.16.0.0/12\n127.0.0.1\nlocalhost\n*.local\ntimestamp.apple.com\n";
#[cfg(target_os = "macos")]
static MACOS_SERVICE: &str = "Wi-Fi";

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

  #[cfg(target_os = "windows")]
  /// Get the windows system proxy config
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

  #[cfg(target_os = "macos")]
  /// Get the macos system proxy config
  pub fn get_sys() -> io::Result<Self> {
    use std::process::Command;

    let http = macproxy::get_proxy(&["-getwebproxy", MACOS_SERVICE])?;
    let https = macproxy::get_proxy(&["-getsecurewebproxy", MACOS_SERVICE])?;
    let sock = macproxy::get_proxy(&["-getsocksfirewallproxy", MACOS_SERVICE])?;

    let mut enable = false;
    let mut server = "".into();

    if sock.0 == "Yes" {
      enable = true;
      server = sock.1;
    }
    if https.0 == "Yes" {
      enable = true;
      server = https.1;
    }
    if http.0 == "Yes" || !enable {
      enable = http.0 == "Yes";
      server = http.1;
    }

    let bypass_output = Command::new("networksetup")
      .args(["-getproxybypassdomains", MACOS_SERVICE])
      .output()?;
    let bypass = std::str::from_utf8(&bypass_output.stdout).unwrap_or(DEFAULT_BYPASS);

    Ok(SysProxyConfig {
      enable,
      server,
      bypass: bypass.into(),
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

  #[cfg(target_os = "macos")]
  /// Set the macos system proxy config
  pub fn set_sys(&self) -> io::Result<()> {
    let enable = self.enable;
    let server = self.server.as_str();
    macproxy::set_proxy("-setwebproxy", MACOS_SERVICE, enable, server)?;
    macproxy::set_proxy("-setsecurewebproxy", MACOS_SERVICE, enable, server)?;
    macproxy::set_proxy("-setsocksfirewallproxy", MACOS_SERVICE, enable, server)
  }
}

#[cfg(target_os = "macos")]
mod macproxy {
  use super::*;
  use std::process::Command;

  /// use networksetup
  /// get the target proxy config
  pub(super) fn get_proxy(args: &[&str; 2]) -> io::Result<(String, String)> {
    let output = Command::new("networksetup").args(args).output()?;
    match std::str::from_utf8(&output.stdout) {
      Ok(stdout) => {
        let enable = parse(stdout, "Enabled:");
        let server = parse(stdout, "Server:");
        let port = parse(stdout, "Port:");
        let server = format!("{}:{}", server, port);
        Ok((enable.into(), server))
      }
      Err(_) => Err(io::Error::from_raw_os_error(1)),
    }
  }

  /// use networksetup
  /// set the target proxy config
  pub(super) fn set_proxy(
    target: &str, // like: -setwebproxy
    device: &str,
    enable: bool,
    server: &str,
  ) -> io::Result<()> {
    let mut split = server.split(":");
    let domain = split.next();
    let port = split.next();

    // can not parse the field
    if domain.is_none() || port.is_none() {
      return Err(io::Error::from_raw_os_error(1));
    }

    let args = vec![target, device, domain.unwrap(), port.unwrap()];
    Command::new("networksetup").args(&args).status()?;

    let target_state = String::from(target) + "state";
    let enable = if enable { "on" } else { "off" };
    let args = vec![target_state.as_str(), device, enable];
    Command::new("networksetup").args(&args).status()?;
    Ok(())
  }

  /// parse the networksetup output
  pub(super) fn parse<'a>(target: &'a str, key: &'a str) -> &'a str {
    match target.find(key) {
      Some(idx) => {
        let idx = idx + key.len();
        let value = &target[idx..];
        let value = match value.find("\n") {
          Some(end) => &value[..end],
          None => value,
        };
        value.trim()
      }
      None => "",
    }
  }

  #[test]
  fn test_get() {
    use std::process::Command;

    let output = Command::new("networksetup")
      .args(["-getwebproxy", "Wi-Fi"])
      .output();

    let output = output.unwrap();
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    let enable = parse(stdout, "Enabled:");
    let server = parse(stdout, "Server:");
    let port = parse(stdout, "Port:");

    println!("enable: {}, server: {}, port: {}", enable, server, port);

    dbg!(SysProxyConfig::get_sys().unwrap());
  }

  #[test]
  fn test_set() {
    let sysproxy = SysProxyConfig::new(true, "7890".into(), None);
    dbg!(sysproxy.set_sys().unwrap());
  }
}

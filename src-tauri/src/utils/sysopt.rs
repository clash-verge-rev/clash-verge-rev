use anyhow::Result;
use serde::{Deserialize, Serialize};

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
}

#[cfg(target_os = "windows")]
impl SysProxyConfig {
  /// Get the windows system proxy config
  pub fn get_sys() -> Result<Self> {
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

  /// Set the windows system proxy config
  pub fn set_sys(&self) -> Result<()> {
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
    cur_var.set_value("ProxyOverride", &self.bypass)?;

    Ok(())
  }
}

#[cfg(target_os = "macos")]
impl SysProxyConfig {
  /// Get the macos system proxy config
  pub fn get_sys() -> Result<Self> {
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

    // change the format to xxx,xxx
    let bypass = std::str::from_utf8(&bypass_output.stdout)
      .unwrap_or(DEFAULT_BYPASS)
      .to_string()
      .split('\n')
      .collect::<Vec<_>>()
      .join(",");

    Ok(SysProxyConfig {
      enable,
      server,
      bypass,
    })
  }

  /// Set the macos system proxy config
  pub fn set_sys(&self) -> Result<()> {
    use std::process::Command;

    let enable = self.enable;
    let server = self.server.as_str();
    let bypass = self.bypass.clone();
    macproxy::set_proxy("-setwebproxy", MACOS_SERVICE, enable, server)?;
    macproxy::set_proxy("-setsecurewebproxy", MACOS_SERVICE, enable, server)?;
    macproxy::set_proxy("-setsocksfirewallproxy", MACOS_SERVICE, enable, server)?;

    let domains = bypass.split(",").collect::<Vec<_>>();
    Command::new("networksetup")
      .args([["-setproxybypassdomains", MACOS_SERVICE].to_vec(), domains].concat())
      .status()?;

    Ok(())
  }
}

#[cfg(target_os = "macos")]
mod macproxy {
  use super::*;
  use anyhow::bail;
  use std::process::Command;

  /// use networksetup
  /// get the target proxy config
  pub(super) fn get_proxy(args: &[&str; 2]) -> Result<(String, String)> {
    let output = Command::new("networksetup").args(args).output()?;

    let stdout = std::str::from_utf8(&output.stdout)?;
    let enable = parse(stdout, "Enabled:");
    let server = parse(stdout, "Server:");
    let port = parse(stdout, "Port:");
    let server = format!("{server}:{port}");
    Ok((enable.into(), server))
  }

  /// use networksetup
  /// set the target proxy config
  pub(super) fn set_proxy(
    target: &str, // like: -setwebproxy
    device: &str,
    enable: bool,
    server: &str,
  ) -> Result<()> {
    let mut split = server.split(":");
    let host = split.next();
    let port = split.next();

    // can not parse the field
    if host.is_none() || port.is_none() {
      bail!("failed to parse the server into host:port");
    }

    let args = vec![target, device, host.unwrap(), port.unwrap()];
    Command::new("networksetup").args(&args).status()?;

    let target_state = String::from(target) + "state";
    let enable = if enable { "on" } else { "off" };
    let args = vec![target_state.as_str(), device, enable];
    Command::new("networksetup").args(&args).status()?;
    Ok(())
  }

  /// parse the networksetup output
  fn parse<'a>(target: &'a str, key: &'a str) -> &'a str {
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

///
/// Linux Desktop System Proxy Supports
/// by using `gsettings`
#[cfg(target_os = "linux")]
impl SysProxyConfig {
  /// Get the system proxy config [http/https/socks]
  pub fn get_sys() -> Result<Self> {
    use std::process::Command;

    let schema = "org.gnome.system.proxy";

    // get enable
    let mode = Command::new("gsettings")
      .args(["get", schema, "mode"])
      .output()?;
    let mode = std::str::from_utf8(&mode.stdout)?;
    let enable = mode == "manual";

    // get bypass
    // Todo: parse the ignore-hosts
    // ['aaa', 'bbb'] -> aaa,bbb
    let ignore = Command::new("gsettings")
      .args(["get", schema, "ignore-hosts"])
      .output()?;
    let ignore = std::str::from_utf8(&ignore.stdout)?;
    let bypass = ignore.to_string();

    let http = Self::get_proxy("http")?;
    let https = Self::get_proxy("https")?;
    let socks = Self::get_proxy("socks")?;

    let mut server = "".into();

    if socks.len() > 0 {
      server = socks;
    }
    if https.len() > 0 {
      server = https;
    }
    if http.len() > 0 {
      server = http;
    }

    Ok(SysProxyConfig {
      enable,
      server,
      bypass,
    })
  }

  /// Get the system proxy config [http/https/socks]
  pub fn set_sys(&self) -> Result<()> {
    use anyhow::bail;
    use std::process::Command;

    let enable = self.enable;
    let server = self.server.as_str();
    let bypass = self.bypass.clone();
    let schema = "org.gnome.system.proxy";

    if enable {
      let mut split = server.split(":");
      let host = split.next();
      let port = split.next();

      if port.is_none() {
        bail!("failed to parse the port");
      }

      let host = format!("'{}'", host.unwrap_or("127.0.0.1"));
      let host = host.as_str();
      let port = port.unwrap();

      let http = format!("{schema}.http");
      Command::new("gsettings")
        .args(["set", http.as_str(), "host", host])
        .status()?;
      Command::new("gsettings")
        .args(["set", http.as_str(), "port", port])
        .status()?;

      let https = format!("{schema}.https");
      Command::new("gsettings")
        .args(["set", https.as_str(), "host", host])
        .status()?;
      Command::new("gsettings")
        .args(["set", https.as_str(), "port", port])
        .status()?;

      let socks = format!("{schema}.socks");
      Command::new("gsettings")
        .args(["set", socks.as_str(), "host", host])
        .status()?;
      Command::new("gsettings")
        .args(["set", socks.as_str(), "port", port])
        .status()?;

      // set bypass
      // Todo: parse the ignore-hosts
      // aaa,bbb,cccc -> ['aaa', 'bbb', 'ccc']
      Command::new("gsettings")
        .args(["set", schema, "ignore-hosts", bypass.as_str()]) //  todo
        .status()?;
    }

    let mode = if enable { "'manual'" } else { "'none'" };
    Command::new("gsettings")
      .args(["set", schema, "mode", mode])
      .status()?;

    Ok(())
  }

  /// help function
  fn get_proxy(typ: &str) -> Result<String> {
    use std::process::Command;

    let schema = format!("org.gnome.system.proxy.{typ}");
    let schema = schema.as_str();

    let host = Command::new("gsettings")
      .args(["get", schema, "host"])
      .output()?;
    let host = std::str::from_utf8(&host.stdout)?;

    let port = Command::new("gsettings")
      .args(["get", schema, "port"])
      .output()?;
    let port = std::str::from_utf8(&port.stdout)?;

    Ok(format!("{host}:{port}"))
  }
}

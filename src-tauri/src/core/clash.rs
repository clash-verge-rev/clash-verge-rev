use super::{PrfEnhancedResult, Profiles, Verge, VergeConfig};
use crate::log_if_err;
use crate::utils::{config, dirs, help};
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::{collections::HashMap, time::Duration};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tauri::Window;
use tokio::time::sleep;

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashInfo {
  /// clash sidecar status
  pub status: String,

  /// clash core port
  pub port: Option<String>,

  /// same as `external-controller`
  pub server: Option<String>,

  /// clash secret
  pub secret: Option<String>,
}

pub struct Clash {
  /// maintain the clash config
  pub config: Mapping,

  /// some info
  pub info: ClashInfo,

  /// clash sidecar
  pub sidecar: Option<CommandChild>,

  /// save the main window
  pub window: Option<Window>,
}

impl Clash {
  pub fn new() -> Clash {
    let config = Clash::read_config();
    let info = Clash::get_info(&config);

    Clash {
      config,
      info,
      sidecar: None,
      window: None,
    }
  }

  /// get clash config
  fn read_config() -> Mapping {
    config::read_yaml::<Mapping>(dirs::clash_path())
  }

  /// save the clash config
  fn save_config(&self) -> Result<()> {
    config::save_yaml(
      dirs::clash_path(),
      &self.config,
      Some("# Default Config For Clash Core\n\n"),
    )
  }

  /// parse the clash's config.yaml
  /// get some information
  fn get_info(clash_config: &Mapping) -> ClashInfo {
    let key_port_1 = Value::from("port");
    let key_port_2 = Value::from("mixed-port");
    let key_server = Value::from("external-controller");
    let key_secret = Value::from("secret");

    let port = match clash_config.get(&key_port_1) {
      Some(value) => match value {
        Value::String(val_str) => Some(val_str.clone()),
        Value::Number(val_num) => Some(val_num.to_string()),
        _ => None,
      },
      _ => None,
    };
    let port = match port {
      Some(_) => port,
      None => match clash_config.get(&key_port_2) {
        Some(value) => match value {
          Value::String(val_str) => Some(val_str.clone()),
          Value::Number(val_num) => Some(val_num.to_string()),
          _ => None,
        },
        _ => None,
      },
    };

    let server = match clash_config.get(&key_server) {
      Some(value) => match value {
        Value::String(val_str) => {
          // `external-controller` could be
          // "127.0.0.1:9090" or ":9090"
          // Todo: maybe it could support single port
          let server = val_str.clone();
          let server = match server.starts_with(":") {
            true => format!("127.0.0.1{server}"),
            false => server,
          };

          Some(server)
        }
        _ => None,
      },
      _ => None,
    };
    let secret = match clash_config.get(&key_secret) {
      Some(value) => match value {
        Value::String(val_str) => Some(val_str.clone()),
        Value::Bool(val_bool) => Some(val_bool.to_string()),
        Value::Number(val_num) => Some(val_num.to_string()),
        _ => None,
      },
      _ => None,
    };

    ClashInfo {
      status: "init".into(),
      port,
      server,
      secret,
    }
  }

  /// save the main window
  pub fn set_window(&mut self, win: Option<Window>) {
    self.window = win;
  }

  /// run clash sidecar
  pub fn run_sidecar(&mut self, profiles: &Profiles, delay: bool) -> Result<()> {
    let app_dir = dirs::app_home_dir();
    let app_dir = app_dir.as_os_str().to_str().unwrap();

    let cmd = Command::new_sidecar("clash")?;
    let (mut rx, cmd_child) = cmd.args(["-d", app_dir]).spawn()?;

    self.sidecar = Some(cmd_child);

    // clash log
    tauri::async_runtime::spawn(async move {
      while let Some(event) = rx.recv().await {
        match event {
          CommandEvent::Stdout(line) => log::info!("[clash]: {}", line),
          CommandEvent::Stderr(err) => log::error!("[clash]: {}", err),
          _ => {}
        }
      }
    });

    // activate profile
    log_if_err!(self.activate(&profiles));
    log_if_err!(self.activate_enhanced(&profiles, delay, true));

    Ok(())
  }

  /// drop clash sidecar
  pub fn drop_sidecar(&mut self) -> Result<()> {
    if let Some(sidecar) = self.sidecar.take() {
      sidecar.kill()?;
    }
    Ok(())
  }

  /// restart clash sidecar
  /// should reactivate profile after restart
  pub fn restart_sidecar(&mut self, profiles: &mut Profiles) -> Result<()> {
    self.update_config();
    self.drop_sidecar()?;
    self.run_sidecar(profiles, false)
  }

  /// update the clash info
  pub fn update_config(&mut self) {
    self.config = Clash::read_config();
    self.info = Clash::get_info(&self.config);
  }

  /// patch update the clash config
  pub fn patch_config(
    &mut self,
    patch: Mapping,
    verge: &mut Verge,
    profiles: &mut Profiles,
  ) -> Result<()> {
    let mix_port_key = Value::from("mixed-port");
    let mut port = None;

    for (key, value) in patch.into_iter() {
      let value = value.clone();

      // check whether the mix_port is changed
      if key == mix_port_key {
        if value.is_number() {
          port = value.as_i64().as_ref().map(|n| n.to_string());
        } else {
          port = value.as_str().as_ref().map(|s| s.to_string());
        }
      }

      self.config.insert(key.clone(), value);
    }

    self.save_config()?;

    if let Some(port) = port {
      self.restart_sidecar(profiles)?;
      verge.init_sysproxy(Some(port));
    }

    Ok(())
  }

  /// revise the `tun` and `dns` config
  fn _tun_mode(mut config: Mapping, enable: bool) -> Mapping {
    macro_rules! revise {
      ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
      };
    }

    // if key not exists then append value
    macro_rules! append {
      ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        if !$map.contains_key(&ret_key) {
          $map.insert(ret_key, Value::from($val));
        }
      };
    }

    // tun config
    let tun_val = config.get(&Value::from("tun"));
    let mut new_tun = Mapping::new();

    if tun_val.is_some() && tun_val.as_ref().unwrap().is_mapping() {
      new_tun = tun_val.as_ref().unwrap().as_mapping().unwrap().clone();
    }

    revise!(new_tun, "enable", enable);

    if enable {
      append!(new_tun, "stack", "gvisor");
      append!(new_tun, "dns-hijack", vec!["198.18.0.2:53"]);
      append!(new_tun, "auto-route", true);
      append!(new_tun, "auto-detect-interface", true);
    }

    revise!(config, "tun", new_tun);

    // dns config
    let dns_val = config.get(&Value::from("dns"));
    let mut new_dns = Mapping::new();

    if dns_val.is_some() && dns_val.as_ref().unwrap().is_mapping() {
      new_dns = dns_val.as_ref().unwrap().as_mapping().unwrap().clone();
    }

    // 借鉴cfw的默认配置
    revise!(new_dns, "enable", enable);

    if enable {
      append!(new_dns, "enhanced-mode", "fake-ip");
      append!(
        new_dns,
        "nameserver",
        vec!["114.114.114.114", "223.5.5.5", "8.8.8.8"]
      );
      append!(new_dns, "fallback", vec![] as Vec<&str>);

      #[cfg(target_os = "windows")]
      append!(
        new_dns,
        "fake-ip-filter",
        vec![
          "dns.msftncsi.com",
          "www.msftncsi.com",
          "www.msftconnecttest.com"
        ]
      );
    }

    revise!(config, "dns", new_dns);
    config
  }

  /// activate the profile
  /// generate a new profile to the temp_dir
  /// then put the path to the clash core
  fn _activate(info: ClashInfo, config: Mapping, window: Option<Window>) -> Result<()> {
    let verge_config = VergeConfig::new();
    let tun_enable = verge_config.enable_tun_mode.unwrap_or(false);

    let config = Clash::_tun_mode(config, tun_enable);

    let temp_path = dirs::profiles_temp_path();
    config::save_yaml(temp_path.clone(), &config, Some("# Clash Verge Temp File"))?;

    tauri::async_runtime::spawn(async move {
      if info.server.is_none() {
        return;
      }

      let server = info.server.unwrap();
      let server = format!("http://{server}/configs");

      let mut headers = HeaderMap::new();
      headers.insert("Content-Type", "application/json".parse().unwrap());

      if let Some(secret) = info.secret.as_ref() {
        let secret = format!("Bearer {}", secret.clone()).parse().unwrap();
        headers.insert("Authorization", secret);
      }

      let mut data = HashMap::new();
      data.insert("path", temp_path.as_os_str().to_str().unwrap());

      // retry 5 times
      for _ in 0..5 {
        match reqwest::ClientBuilder::new().no_proxy().build() {
          Ok(client) => {
            let builder = client.put(&server).headers(headers.clone()).json(&data);

            match builder.send().await {
              Ok(resp) => {
                if resp.status() != 204 {
                  log::error!("failed to activate clash for status \"{}\"", resp.status());
                }

                // emit the window to update something
                if let Some(window) = window {
                  window.emit("verge://refresh-clash-config", "yes").unwrap();
                }

                // do not retry
                break;
              }
              Err(err) => log::error!("failed to activate for `{err}`"),
            }
          }
          Err(err) => log::error!("failed to activate for `{err}`"),
        }
        sleep(Duration::from_millis(500)).await;
      }
    });

    Ok(())
  }

  /// enhanced profiles mode
  /// - (sync) refresh config if enhance chain is null
  /// - (async) enhanced config
  pub fn activate_enhanced(&self, profiles: &Profiles, delay: bool, skip: bool) -> Result<()> {
    if self.window.is_none() {
      bail!("failed to get the main window");
    }

    let event_name = help::get_uid("e");
    let event_name = format!("enhanced-cb-{event_name}");

    // generate the payload
    let payload = profiles.gen_enhanced(event_name.clone())?;

    let info = self.info.clone();

    // do not run enhanced
    if payload.chain.len() == 0 {
      if skip {
        return Ok(());
      }

      let mut config = self.config.clone();
      let filter_data = Clash::strict_filter(payload.current);

      for (key, value) in filter_data.into_iter() {
        config.insert(key, value);
      }

      return Clash::_activate(info, config, self.window.clone());
    }

    let window = self.window.clone().unwrap();
    let window_move = self.window.clone();

    window.once(&event_name, move |event| {
      if let Some(result) = event.payload() {
        let result: PrfEnhancedResult = serde_json::from_str(result).unwrap();

        if let Some(data) = result.data {
          let mut config = Clash::read_config();
          let filter_data = Clash::loose_filter(data); // loose filter

          for (key, value) in filter_data.into_iter() {
            config.insert(key, value);
          }

          log_if_err!(Clash::_activate(info, config, window_move));
          log::info!("profile enhanced status {}", result.status);
        }

        result.error.map(|err| log::error!("{err}"));
      }
    });

    tauri::async_runtime::spawn(async move {
      // wait the window setup during resolve app
      if delay {
        sleep(Duration::from_secs(2)).await;
      }
      window.emit("script-handler", payload).unwrap();
    });

    Ok(())
  }

  /// activate the profile
  /// auto activate enhanced profile
  pub fn activate(&self, profiles: &Profiles) -> Result<()> {
    let data = profiles.gen_activate()?;
    let data = Clash::strict_filter(data);

    let info = self.info.clone();
    let mut config = self.config.clone();

    for (key, value) in data.into_iter() {
      config.insert(key, value);
    }

    Clash::_activate(info, config, self.window.clone())
  }

  /// only 5 default fields available (clash config fields)
  /// convert to lowercase
  fn strict_filter(config: Mapping) -> Mapping {
    // Only the following fields are allowed:
    // proxies/proxy-providers/proxy-groups/rule-providers/rules
    let valid_keys = vec![
      "proxies",
      "proxy-providers",
      "proxy-groups",
      "rules",
      "rule-providers",
    ];

    let mut new_config = Mapping::new();

    for (key, value) in config.into_iter() {
      key.as_str().map(|key_str| {
        // change to lowercase
        let mut key_str = String::from(key_str);
        key_str.make_ascii_lowercase();

        // filter
        if valid_keys.contains(&&*key_str) {
          new_config.insert(Value::String(key_str), value);
        }
      });
    }

    new_config
  }

  /// more clash config fields available
  /// convert to lowercase
  fn loose_filter(config: Mapping) -> Mapping {
    // all of these can not be revised by script or merge
    // http/https/socks port should be under control
    let not_allow = vec![
      "port",
      "socks-port",
      "mixed-port",
      "allow-lan",
      "mode",
      "external-controller",
      "secret",
      "log-level",
    ];

    let mut new_config = Mapping::new();

    for (key, value) in config.into_iter() {
      key.as_str().map(|key_str| {
        // change to lowercase
        let mut key_str = String::from(key_str);
        key_str.make_ascii_lowercase();

        // filter
        if !not_allow.contains(&&*key_str) {
          new_config.insert(Value::String(key_str), value);
        }
      });
    }

    new_config
  }
}

impl Default for Clash {
  fn default() -> Self {
    Clash::new()
  }
}

impl Drop for Clash {
  fn drop(&mut self) {
    if let Err(err) = self.drop_sidecar() {
      log::error!("{err}");
    }
  }
}

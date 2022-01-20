use super::ProfilesConfig;
use crate::utils::{config, dirs};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use tauri::api::process::{Command, CommandChild, CommandEvent};

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

#[derive(Debug)]
pub struct Clash {
  /// maintain the clash config
  pub config: Mapping,

  /// some info
  pub info: ClashInfo,

  /// clash sidecar
  pub sidecar: Option<CommandChild>,
}

static CLASH_CONFIG: &str = "config.yaml";

// todo: be able to change config field
impl Clash {
  pub fn new() -> Clash {
    let config = Clash::get_config();
    let info = Clash::get_info(&config);

    Clash {
      config,
      info,
      sidecar: None,
    }
  }

  /// parse the clash's config.yaml
  /// get some information
  fn get_info(clash_config: &Mapping) -> ClashInfo {
    let key_port_1 = Value::String("port".to_string());
    let key_port_2 = Value::String("mixed-port".to_string());
    let key_server = Value::String("external-controller".to_string());
    let key_secret = Value::String("secret".to_string());

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
        Value::String(val_str) => Some(val_str.clone()),
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

  /// run clash sidecar
  pub fn run_sidecar(&mut self) -> Result<(), String> {
    let app_dir = dirs::app_home_dir();
    let app_dir = app_dir.as_os_str().to_str().unwrap();

    match Command::new_sidecar("clash") {
      Ok(cmd) => match cmd.args(["-d", app_dir]).spawn() {
        Ok((mut rx, cmd_child)) => {
          self.sidecar = Some(cmd_child);

          // clash log
          tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
              match event {
                CommandEvent::Stdout(line) => log::info!("[stdout]: {}", line),
                CommandEvent::Stderr(err) => log::error!("[stderr]: {}", err),
                _ => {}
              }
            }
          });
          Ok(())
        }
        Err(err) => Err(err.to_string()),
      },
      Err(err) => Err(err.to_string()),
    }
  }

  /// drop clash sidecar
  pub fn drop_sidecar(&mut self) -> Result<(), String> {
    if let Some(sidecar) = self.sidecar.take() {
      if let Err(err) = sidecar.kill() {
        return Err(format!("failed to drop clash for \"{}\"", err));
      }
    }
    Ok(())
  }

  /// restart clash sidecar
  /// should reactivate profile after restart
  pub fn restart_sidecar(&mut self, profiles: &mut ProfilesConfig) -> Result<(), String> {
    self.update_config();
    self.drop_sidecar()?;
    self.run_sidecar()?;
    profiles.activate(&self)
  }

  /// update the clash info
  pub fn update_config(&mut self) {
    self.config = Clash::get_config();
    self.info = Clash::get_info(&self.config);
  }

  /// get clash config
  fn get_config() -> Mapping {
    config::read_yaml::<Mapping>(dirs::app_home_dir().join(CLASH_CONFIG))
  }

  /// save the clash config
  fn save_config(&self) -> Result<(), String> {
    config::save_yaml(
      dirs::app_home_dir().join(CLASH_CONFIG),
      &self.config,
      Some("# Default Config For Clash Core\n\n"),
    )
  }

  /// patch update the clash config
  pub fn patch_config(
    &mut self,
    patch: Mapping,
    profiles: &mut ProfilesConfig,
  ) -> Result<(), String> {
    for (key, value) in patch.iter() {
      let value = value.clone();
      let key_str = key.as_str().clone().unwrap_or("");

      // restart the clash
      if key_str == "mixed-port" {
        self.restart_sidecar(profiles)?;
      }

      if self.config.contains_key(key) {
        self.config[key] = value.clone();
      } else {
        self.config.insert(key.clone(), value.clone());
      }
    }
    self.save_config()
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
      log::error!("{}", err);
    }
  }
}

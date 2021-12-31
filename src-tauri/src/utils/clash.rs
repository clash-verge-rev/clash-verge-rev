extern crate log;

use crate::{
  events::{
    emit::{clash_start, ClashInfoPayload},
    state,
  },
  utils::{
    app_home_dir, clash,
    config::{read_clash_controller, read_profiles, read_yaml, save_yaml},
  },
};
use reqwest::header::HeaderMap;
use serde_yaml::{Mapping, Value};
use std::{collections::HashMap, env::temp_dir};
use tauri::{
  api::process::{Command, CommandEvent},
  AppHandle, Manager,
};

/// Run the clash bin
pub fn run_clash_bin(app_handle: &AppHandle) -> ClashInfoPayload {
  let app_dir = app_home_dir();
  let app_dir = app_dir.as_os_str().to_str().unwrap();

  let mut payload = ClashInfoPayload {
    status: "success".to_string(),
    controller: None,
    message: None,
  };

  let result = match Command::new_sidecar("clash") {
    Ok(cmd) => match cmd.args(["-d", app_dir]).spawn() {
      Ok(res) => Ok(res),
      Err(err) => Err(err.to_string()),
    },
    Err(err) => Err(err.to_string()),
  };

  match result {
    Ok((mut rx, cmd_child)) => {
      log::info!("Successfully execute clash sidecar");
      payload.controller = Some(read_clash_controller());

      // update the profile
      let payload_ = payload.clone();
      tauri::async_runtime::spawn(async move {
        if let Err(err) = clash::put_clash_profile(&payload_).await {
          log::error!("failed to put config for `{}`", err);
        };
      });

      if let Ok(mut state) = app_handle.state::<state::ClashSidecarState>().0.lock() {
        *state = Some(cmd_child);
      };

      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => log::info!("[stdout]: {}", line),
            CommandEvent::Stderr(err) => log::error!("[stderr]: {}", err),
            _ => {}
          }
        }
      });
    }
    Err(err) => {
      log::error!("Failed to execute clash sidecar for \"{}\"", err);
      payload.status = "error".to_string();
      payload.message = Some(err.to_string());
    }
  };

  clash_start(app_handle, &payload);
  payload
}

/// Update the clash profile firstly
pub async fn put_clash_profile(payload: &ClashInfoPayload) -> Result<(), String> {
  let profile = {
    let profiles = read_profiles();
    let current = profiles.current.unwrap_or(0) as usize;
    match profiles.items {
      Some(items) => {
        if items.len() == 0 {
          return Err("can not read profiles".to_string());
        }
        let idx = if current < items.len() { current } else { 0 };
        items[idx].clone()
      }
      None => {
        return Err("can not read profiles".to_string());
      }
    }
  };

  // temp profile's path
  let temp_path = temp_dir().join("clash-verge-runtime.yaml");

  // generate temp profile
  {
    let file_name = match profile.file {
      Some(file_name) => file_name.clone(),
      None => return Err(format!("profile item should have `file` field")),
    };

    let file_path = app_home_dir().join("profiles").join(file_name);
    if !file_path.exists() {
      return Err(format!("profile `{:?}` not exists", file_path));
    }

    // Only the following fields are allowed:
    // proxies/proxy-providers/proxy-groups/rule-providers/rules
    let config = read_yaml::<Mapping>(file_path.clone());
    let mut new_config = Mapping::new();
    vec![
      "proxies",
      "proxy-providers",
      "proxy-groups",
      "rule-providers",
      "rules",
    ]
    .iter()
    .map(|item| Value::String(item.to_string()))
    .for_each(|key| {
      if config.contains_key(&key) {
        let value = config[&key].clone();
        new_config.insert(key, value);
      }
    });

    match save_yaml(
      temp_path.clone(),
      &new_config,
      Some("# Clash Verge Temp File"),
    ) {
      Err(err) => return Err(err),
      _ => {}
    };
  }

  let ctrl = payload.controller.clone().unwrap();
  let server = format!("http://{}/configs", ctrl.server.unwrap());

  let mut headers = HeaderMap::new();
  headers.insert("Content-Type", "application/json".parse().unwrap());

  if let Some(secret) = ctrl.secret {
    headers.insert(
      "Authorization",
      format!("Bearer {}", secret).parse().unwrap(),
    );
  }

  let mut data = HashMap::new();
  data.insert("path", temp_path.as_os_str().to_str().unwrap());

  let client = reqwest::Client::new();
  match client.put(server).headers(headers).json(&data).send().await {
    Ok(_) => Ok(()),
    Err(err) => Err(format!("request failed `{}`", err.to_string())),
  }
}

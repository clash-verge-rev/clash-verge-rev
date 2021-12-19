extern crate log;

use crate::{
  events::emit::{clash_start, ClashInfoPayload},
  utils::{
    app_home_dir,
    config::{read_clash_controller, read_profiles},
  },
};
use reqwest::header::HeaderMap;
use std::{collections::HashMap, env::temp_dir, fs};
use tauri::{
  api::process::{Command, CommandEvent},
  AppHandle,
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
    Ok((mut rx, _)) => {
      log::info!("Successfully execute clash sidecar");
      payload.controller = Some(read_clash_controller());

      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => log::info!("{}", line),
            CommandEvent::Stderr(err) => log::error!("{}", err),
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

  // generate temp profile
  let file_name = match profile.file {
    Some(file_name) => file_name.clone(),
    None => {
      return Err("the profile item should have `file` field".to_string());
    }
  };

  let file_path = app_home_dir().join("profiles").join(file_name);
  let temp_path = temp_dir().join("clash-verge-runtime.yaml");

  if !file_path.exists() {
    return Err(format!("the profile `{:?}` not exists", file_path));
  }
  fs::copy(file_path, temp_path.clone()).unwrap();

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
    Err(err) => Err(format!("request failed with status `{}`", err.to_string())),
  }
}

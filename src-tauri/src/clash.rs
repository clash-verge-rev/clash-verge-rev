extern crate reqwest;
extern crate serde_yaml;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::api::path::home_dir;
use tauri::api::process::{Command, CommandEvent};

/// Get the clash config dir
pub fn get_config_dir() -> PathBuf {
  home_dir()
    .unwrap()
    .join(Path::new(".config"))
    .join(Path::new("clash-verge"))
}

/// Initialize the default config dir for clash
pub fn init_clash_config() {
  let config_dir = get_config_dir();
  let conifg_yaml = config_dir.join("config.yaml");

  let default_yaml =
    "mixed-port: 7890\nallow-lan: false\nexternal-controller: 127.0.0.1:9090\nsecret: ''\n";
  let mut yaml_obj = serde_yaml::from_str::<serde_yaml::Value>(&default_yaml).unwrap();

  if !config_dir.exists() {
    let config_dir = config_dir.clone();
    fs::create_dir(config_dir).unwrap();
    let mut file = fs::File::create(conifg_yaml).unwrap();
    file.write(default_yaml.as_bytes()).unwrap();
  }

  let yaml_path = &config_dir.join("config.yaml");
  let yaml_str = fs::read_to_string(yaml_path).unwrap();
  yaml_obj = serde_yaml::from_str::<serde_yaml::Value>(&yaml_str).unwrap();

  println!("{:?}", yaml_obj);
}

/// Run the clash bin
pub fn run_clash_bin(config_dirs: &str) {
  let (mut rx, mut _child) = Command::new_sidecar("clash")
    .expect("failed to create clash binary")
    .args(["-d", config_dirs])
    .spawn()
    .expect("failed to spawn sidecar");

  tauri::async_runtime::spawn(async move {
    // read events such as stdout
    while let Some(event) = rx.recv().await {
      if let CommandEvent::Stdout(line) = event {
        println!("{:?}", line);
      }
    }
  });
}

pub async fn fetch_url(profile_url: &str) -> Result<(), reqwest::Error> {
  let resp = reqwest::get(profile_url).await?;
  println!("{:#?}", resp);

  let header = resp.headers().clone();
  println!("{:?}", header);

  let data = resp.text_with_charset("utf-8").await?;
  println!("{:#?}", data);
  Ok(())
}

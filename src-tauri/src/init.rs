extern crate serde_yaml;

use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Root};
use log4rs::encode::pattern::PatternEncoder;
use serde_yaml::Mapping;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::api::path::home_dir;

const CLASH_CONFIG: &str = r#"
mixed-port: 7890
allow-lan: false
external-controller: 127.0.0.1:9090
secret: ''
"#;

const VERGE_CONFIG: &str = r#"
nothing: ohh!
"#;

/// get the verge app home dir
pub fn app_home_dir() -> PathBuf {
  home_dir()
    .unwrap()
    .join(Path::new(".config"))
    .join(Path::new("clash-verge"))
}

/// initialize the app home dir
fn init_app_dir() -> PathBuf {
  let app_dir = app_home_dir();
  if !app_dir.exists() {
    fs::create_dir(&app_dir).unwrap();
  }
  app_dir
}

/// initialize the logs dir
fn init_log_dir() -> PathBuf {
  let log_dir = app_home_dir().join("logs");
  if !log_dir.exists() {
    fs::create_dir(&log_dir).unwrap();
  }
  log_dir
}

/// initialize this instance's log file
fn init_log() {
  let log_dir = init_log_dir();
  let log_time = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();
  let log_file = format!("log-{:?}", log_time);
  let log_file = log_dir.join(log_file);

  let stdout = ConsoleAppender::builder().build();
  let tofile = FileAppender::builder()
    .encoder(Box::new(PatternEncoder::new(
      "{d(%Y-%m-%d %H:%M:%S)} - {m}{n}",
    )))
    .build(log_file)
    .unwrap();

  let config = Config::builder()
    .appender(Appender::builder().build("stdout", Box::new(stdout)))
    .appender(Appender::builder().build("file", Box::new(tofile)))
    .build(
      Root::builder()
        .appenders(["stdout", "file"])
        .build(LevelFilter::Debug),
    )
    .unwrap();

  log4rs::init_config(config).unwrap();
}

/// Initialize & Get the clash config
fn init_clash_config() -> Mapping {
  let app_dir = app_home_dir();
  let yaml_path = app_dir.join("config.yaml");
  let mut yaml_obj = serde_yaml::from_str::<Mapping>(CLASH_CONFIG).unwrap();

  if !yaml_path.exists() {
    fs::File::create(yaml_path)
      .unwrap()
      .write(CLASH_CONFIG.as_bytes())
      .unwrap();
  } else {
    let yaml_str = fs::read_to_string(yaml_path).unwrap();
    let user_obj = serde_yaml::from_str::<Mapping>(&yaml_str).unwrap();
    for (key, value) in user_obj.iter() {
      yaml_obj.insert(key.clone(), value.clone());
    }
  }
  yaml_obj
}

/// Initialize & Get the app config
fn init_verge_config() -> Mapping {
  let app_dir = app_home_dir();
  let yaml_path = app_dir.join("verge.yaml");
  let mut yaml_obj = serde_yaml::from_str::<Mapping>(VERGE_CONFIG).unwrap();

  if !yaml_path.exists() {
    fs::File::create(yaml_path)
      .unwrap()
      .write(VERGE_CONFIG.as_bytes())
      .unwrap();
  } else {
    let yaml_str = fs::read_to_string(yaml_path).unwrap();
    let user_obj = serde_yaml::from_str::<Mapping>(&yaml_str).unwrap();
    for (key, value) in user_obj.iter() {
      yaml_obj.insert(key.clone(), value.clone());
    }
  }
  yaml_obj
}

#[derive(Debug)]
pub struct InitApp {
  pub clash_config: Mapping,
  pub verge_config: Mapping,
}

/// initialize app
pub fn init_app() -> InitApp {
  init_app_dir();
  init_log();

  let clash_config = init_clash_config();
  let verge_config = init_verge_config();

  InitApp {
    clash_config,
    verge_config,
  }
}

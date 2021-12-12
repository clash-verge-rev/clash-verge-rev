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
use tauri::api::path::{home_dir, resource_dir};
use tauri::PackageInfo;

/// get the verge app home dir
pub fn app_home_dir() -> PathBuf {
  home_dir()
    .unwrap()
    .join(Path::new(".config"))
    .join(Path::new("clash-verge"))
}

/// initialize this instance's log file
fn init_log(log_dir: &PathBuf) {
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

/// Initialize the clash config file
fn init_clash_config(app_dir: &PathBuf, res_dir: &PathBuf) {
  let yaml_path = app_dir.join("config.yaml");
  let yaml_tmpl = res_dir.join("config_tmp.yaml");

  if !yaml_path.exists() {
    if yaml_tmpl.exists() {
      fs::copy(yaml_tmpl, yaml_path).unwrap();
    } else {
      let content = "mixed-port: 7890\nallow-lan: false\n".as_bytes();
      fs::File::create(yaml_path).unwrap().write(content).unwrap();
    }
  }

  let mmdb_path = app_dir.join("Country.mmdb");
  let mmdb_tmpl = res_dir.join("Country.mmdb");

  if !mmdb_path.exists() && mmdb_tmpl.exists() {
    fs::copy(mmdb_tmpl, mmdb_path).unwrap();
  }
}

/// Initialize the verge app config file
fn init_verge_config(app_dir: &PathBuf, res_dir: &PathBuf) {
  let yaml_path = app_dir.join("verge.yaml");
  let yaml_tmpl = res_dir.join("verge_tmp.yaml");

  if !yaml_path.exists() {
    if yaml_tmpl.exists() {
      fs::copy(yaml_tmpl, yaml_path).unwrap();
    } else {
      let content = "".as_bytes();
      fs::File::create(yaml_path).unwrap().write(content).unwrap();
    }
  }
}

/// initialize app
pub fn init_app(package_info: &PackageInfo) {
  // create app dir
  let app_dir = app_home_dir();
  let log_dir = app_dir.join("logs");
  let profiles_dir = app_dir.join("profiles");

  let res_dir = resource_dir(package_info).unwrap().join("resources");

  if !app_dir.exists() {
    fs::create_dir(&app_dir).unwrap();
  }
  if !log_dir.exists() {
    fs::create_dir(&log_dir).unwrap();
  }
  if !profiles_dir.exists() {
    fs::create_dir(&profiles_dir).unwrap();
  }

  init_log(&log_dir);
  init_clash_config(&app_dir, &res_dir);
  init_verge_config(&app_dir, &res_dir);
}

/// Get the user config of clash core
pub fn read_clash_config() -> Mapping {
  let yaml_path = app_home_dir().join("config.yaml");
  let yaml_str = fs::read_to_string(yaml_path).unwrap();
  serde_yaml::from_str::<Mapping>(&yaml_str).unwrap()
}

/// Get the user config of verge
pub fn read_verge_config() -> Mapping {
  let yaml_path = app_home_dir().join("verge.yaml");
  let yaml_str = fs::read_to_string(yaml_path).unwrap();
  serde_yaml::from_str::<Mapping>(&yaml_str).unwrap()
}

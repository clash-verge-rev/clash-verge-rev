extern crate serde_yaml;

use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Root};
use log4rs::encode::pattern::PatternEncoder;
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

/// Initialize all the files from resources
fn init_config_file(app_dir: &PathBuf, res_dir: &PathBuf) {
  // target path
  let clash_path = app_dir.join("config.yaml");
  let verge_path = app_dir.join("verge.yaml");
  let profile_path = app_dir.join("profiles.yaml");
  let mmdb_path = app_dir.join("Country.mmdb");

  // template path
  let clash_tmpl = res_dir.join("config_tmp.yaml");
  let verge_tmpl = res_dir.join("verge_tmp.yaml");
  let profiles_tmpl = res_dir.join("profiles_tmp.yaml");
  let mmdb_tmpl = res_dir.join("Country.mmdb");

  if !clash_path.exists() {
    if clash_tmpl.exists() {
      fs::copy(clash_tmpl, clash_path).unwrap();
    } else {
      // make sure that the config.yaml not null
      let content = "mixed-port: 7890\nallow-lan: false\n".as_bytes();
      fs::File::create(clash_path)
        .unwrap()
        .write(content)
        .unwrap();
    }
  }

  // only copy it
  if !verge_path.exists() && verge_tmpl.exists() {
    fs::copy(verge_tmpl, verge_path).unwrap();
  }
  if !profile_path.exists() && profiles_tmpl.exists() {
    fs::copy(profiles_tmpl, profile_path).unwrap();
  }
  if !mmdb_path.exists() && mmdb_tmpl.exists() {
    fs::copy(mmdb_tmpl, mmdb_path).unwrap();
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
  init_config_file(&app_dir, &res_dir);
}

use crate::utils::{dirs, tmpl};
use anyhow::Result;
use chrono::Local;
use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::PackageInfo;

/// initialize this instance's log file
fn init_log(log_dir: &PathBuf) -> Result<()> {
  let local_time = Local::now().format("%Y-%m-%d-%H%M%S").to_string();
  let log_file = format!("{}.log", local_time);
  let log_file = log_dir.join(log_file);

  let time_format = "{d(%Y-%m-%d %H:%M:%S)} - {m}{n}";
  let stdout = ConsoleAppender::builder()
    .encoder(Box::new(PatternEncoder::new(time_format)))
    .build();
  let tofile = FileAppender::builder()
    .encoder(Box::new(PatternEncoder::new(time_format)))
    .build(log_file)?;

  let config = Config::builder()
    .appender(Appender::builder().build("stdout", Box::new(stdout)))
    .appender(Appender::builder().build("file", Box::new(tofile)))
    .logger(
      Logger::builder()
        .appenders(["file", "stdout"])
        .additive(false)
        .build("app", LevelFilter::Info),
    )
    .build(Root::builder().appender("stdout").build(LevelFilter::Info))?;

  log4rs::init_config(config)?;

  Ok(())
}

/// Initialize all the files from resources
fn init_config(app_dir: &PathBuf) -> Result<()> {
  // target path
  let clash_path = app_dir.join("config.yaml");
  let verge_path = app_dir.join("verge.yaml");
  let profile_path = app_dir.join("profiles.yaml");

  if !clash_path.exists() {
    fs::File::create(clash_path)?.write(tmpl::CLASH_CONFIG)?;
  }
  if !verge_path.exists() {
    fs::File::create(verge_path)?.write(tmpl::VERGE_CONFIG)?;
  }
  if !profile_path.exists() {
    fs::File::create(profile_path)?.write(tmpl::PROFILES_CONFIG)?;
  }
  Ok(())
}

/// initialize app
pub fn init_app(package_info: &PackageInfo) {
  // create app dir
  let app_dir = dirs::app_home_dir();
  let log_dir = dirs::app_logs_dir();
  let profiles_dir = dirs::app_profiles_dir();

  let res_dir = dirs::app_resources_dir(package_info);

  if !app_dir.exists() {
    let _ = fs::create_dir_all(&app_dir);
  }
  if !log_dir.exists() {
    let _ = fs::create_dir_all(&log_dir);
  }
  if !profiles_dir.exists() {
    let _ = fs::create_dir_all(&profiles_dir);
  }

  crate::log_if_err!(init_log(&log_dir));

  crate::log_if_err!(init_config(&app_dir));

  // copy the resource file
  let mmdb_path = app_dir.join("Country.mmdb");
  let mmdb_tmpl = res_dir.join("Country.mmdb");
  if !mmdb_path.exists() && mmdb_tmpl.exists() {
    let _ = fs::copy(mmdb_tmpl, mmdb_path);
  }

  // copy the wintun.dll
  #[cfg(target_os = "windows")]
  {
    let wintun_path = app_dir.join("wintun.dll");
    let wintun_tmpl = res_dir.join("wintun.dll");
    if !wintun_path.exists() && wintun_tmpl.exists() {
      let _ = fs::copy(wintun_tmpl, wintun_path);
    }
  }
}

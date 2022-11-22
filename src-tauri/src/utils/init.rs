use crate::config::*;
use crate::utils::{dirs, help};
use anyhow::Result;
use chrono::Local;
use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use std::fs;
use tauri::PackageInfo;

/// initialize this instance's log file
fn init_log() -> Result<()> {
    let log_dir = dirs::app_logs_dir()?;
    if !log_dir.exists() {
        let _ = fs::create_dir_all(&log_dir);
    }

    let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let log_file = format!("{}.log", local_time);
    let log_file = log_dir.join(log_file);

    #[cfg(feature = "verge-dev")]
    let time_format = "{d(%Y-%m-%d %H:%M:%S)} {l} - {M} {m}{n}";
    #[cfg(not(feature = "verge-dev"))]
    let time_format = "{d(%Y-%m-%d %H:%M:%S)} {l} - {m}{n}";

    let encode = Box::new(PatternEncoder::new(time_format));

    let stdout = ConsoleAppender::builder().encoder(encode.clone()).build();
    let tofile = FileAppender::builder().encoder(encode).build(log_file)?;

    #[cfg(feature = "verge-dev")]
    let level = LevelFilter::Debug;
    #[cfg(not(feature = "verge-dev"))]
    let level = LevelFilter::Info;

    let config = Config::builder()
        .appender(Appender::builder().build("stdout", Box::new(stdout)))
        .appender(Appender::builder().build("file", Box::new(tofile)))
        .logger(
            Logger::builder()
                .appenders(["file", "stdout"])
                .additive(false)
                .build("app", level),
        )
        .build(Root::builder().appender("stdout").build(LevelFilter::Info))?;

    log4rs::init_config(config)?;

    Ok(())
}

/// Initialize all the files from resources
pub fn init_config() -> Result<()> {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = dirs::init_portable_flag();
    }

    let _ = init_log();

    crate::log_err!(dirs::app_home_dir().map(|app_dir| {
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
    }));

    crate::log_err!(dirs::app_profiles_dir().map(|profiles_dir| {
        if !profiles_dir.exists() {
            let _ = fs::create_dir_all(&profiles_dir);
        }
    }));

    crate::log_err!(dirs::clash_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IClashTemp::template().0, Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    crate::log_err!(dirs::verge_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IVerge::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    crate::log_err!(dirs::profiles_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IProfiles::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    Ok(())
}

/// initialize app
pub fn init_resources(package_info: &PackageInfo) -> Result<()> {
    let app_dir = dirs::app_home_dir()?;
    let res_dir = dirs::app_resources_dir(package_info)?;

    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    if !res_dir.exists() {
        let _ = fs::create_dir_all(&res_dir);
    }

    // copy the resource file
    for file in ["Country.mmdb", "geoip.dat", "geosite.dat", "wintun.dll"].iter() {
        let src_path = res_dir.join(file);
        let target_path = app_dir.join(file);
        if src_path.exists() {
            let _ = fs::copy(src_path, target_path);
        }
    }

    Ok(())
}

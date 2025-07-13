use crate::{
    config::*,
    core::handle,
    utils::{dirs, help},
};
use anyhow::Result;
use chrono::{Local, TimeZone};
use log::LevelFilter;
use log4rs::{
    append::{console::ConsoleAppender, file::FileAppender},
    config::{Appender, Logger, Root},
    encode::pattern::PatternEncoder,
};
use std::{
    fs::{self, DirEntry},
    path::PathBuf,
    str::FromStr,
};
use tauri_plugin_shell::ShellExt;

/// initialize this instance's log file
fn init_log() -> Result<()> {
    let log_dir = dirs::app_logs_dir()?;
    if !log_dir.exists() {
        let _ = fs::create_dir_all(&log_dir);
    }

    let log_level = Config::verge().latest_ref().get_log_level();
    if log_level == LevelFilter::Off {
        return Ok(());
    }

    let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
    let log_file = format!("{local_time}.log");
    let log_file = log_dir.join(log_file);

    let log_pattern = match log_level {
        LevelFilter::Trace => "{d(%Y-%m-%d %H:%M:%S)} {l} [{M}] - {m}{n}",
        _ => "{d(%Y-%m-%d %H:%M:%S)} {l} - {m}{n}",
    };

    let encode = Box::new(PatternEncoder::new(log_pattern));

    let stdout = ConsoleAppender::builder().encoder(encode.clone()).build();
    let tofile = FileAppender::builder().encoder(encode).build(log_file)?;

    let mut logger_builder = Logger::builder();
    let mut root_builder = Root::builder();

    let log_more = log_level == LevelFilter::Trace || log_level == LevelFilter::Debug;

    logger_builder = logger_builder.appenders(["file"]);
    if log_more {
        root_builder = root_builder.appenders(["file"]);
    }

    let (config, _) = log4rs::config::Config::builder()
        .appender(Appender::builder().build("stdout", Box::new(stdout)))
        .appender(Appender::builder().build("file", Box::new(tofile)))
        .logger(logger_builder.additive(false).build("app", log_level))
        .build_lossy(root_builder.build(log_level));

    log4rs::init_config(config)?;

    Ok(())
}

/// 删除log文件
pub fn delete_log() -> Result<()> {
    let log_dir = dirs::app_logs_dir()?;
    if !log_dir.exists() {
        return Ok(());
    }

    let auto_log_clean = {
        let verge = Config::verge();
        let verge = verge.latest_ref();
        verge.auto_log_clean.unwrap_or(0)
    };

    let day = match auto_log_clean {
        1 => 7,
        2 => 30,
        3 => 90,
        _ => return Ok(()),
    };

    log::debug!(target: "app", "try to delete log files, day: {day}");

    // %Y-%m-%d to NaiveDateTime
    let parse_time_str = |s: &str| {
        let sa: Vec<&str> = s.split('-').collect();
        if sa.len() != 4 {
            return Err(anyhow::anyhow!("invalid time str"));
        }

        let year = i32::from_str(sa[0])?;
        let month = u32::from_str(sa[1])?;
        let day = u32::from_str(sa[2])?;
        let time = chrono::NaiveDate::from_ymd_opt(year, month, day)
            .ok_or(anyhow::anyhow!("invalid time str"))?
            .and_hms_opt(0, 0, 0)
            .ok_or(anyhow::anyhow!("invalid time str"))?;
        Ok(time)
    };

    let process_file = |file: DirEntry| -> Result<()> {
        let file_name = file.file_name();
        let file_name = file_name.to_str().unwrap_or_default();

        if file_name.ends_with(".log") {
            let now = Local::now();
            let created_time = parse_time_str(&file_name[0..file_name.len() - 4])?;
            let file_time = Local
                .from_local_datetime(&created_time)
                .single()
                .ok_or(anyhow::anyhow!("invalid local datetime"))?;

            let duration = now.signed_duration_since(file_time);
            if duration.num_days() > day {
                let file_path = file.path();
                let _ = fs::remove_file(file_path);
                log::info!(target: "app", "delete log file: {file_name}");
            }
        }
        Ok(())
    };

    for file in fs::read_dir(&log_dir)?.flatten() {
        let _ = process_file(file);
    }

    let service_log_dir = log_dir.join("service");
    for file in fs::read_dir(service_log_dir)?.flatten() {
        let _ = process_file(file);
    }

    Ok(())
}

/// 初始化DNS配置文件
fn init_dns_config() -> Result<()> {
    use serde_yaml::Value;

    // 创建DNS子配置
    let dns_config = serde_yaml::Mapping::from_iter([
        ("enable".into(), Value::Bool(true)),
        ("listen".into(), Value::String(":53".into())),
        ("enhanced-mode".into(), Value::String("fake-ip".into())),
        (
            "fake-ip-range".into(),
            Value::String("198.18.0.1/16".into()),
        ),
        (
            "fake-ip-filter-mode".into(),
            Value::String("blacklist".into()),
        ),
        ("prefer-h3".into(), Value::Bool(false)),
        ("respect-rules".into(), Value::Bool(false)),
        ("use-hosts".into(), Value::Bool(false)),
        ("use-system-hosts".into(), Value::Bool(false)),
        (
            "fake-ip-filter".into(),
            Value::Sequence(vec![
                Value::String("*.lan".into()),
                Value::String("*.local".into()),
                Value::String("*.arpa".into()),
                Value::String("time.*.com".into()),
                Value::String("ntp.*.com".into()),
                Value::String("time.*.com".into()),
                Value::String("+.market.xiaomi.com".into()),
                Value::String("localhost.ptlogin2.qq.com".into()),
                Value::String("*.msftncsi.com".into()),
                Value::String("www.msftconnecttest.com".into()),
            ]),
        ),
        (
            "default-nameserver".into(),
            Value::Sequence(vec![
                Value::String("system".into()),
                Value::String("223.6.6.6".into()),
                Value::String("8.8.8.8".into()),
                Value::String("2400:3200::1".into()),
                Value::String("2001:4860:4860::8888".into()),
            ]),
        ),
        (
            "nameserver".into(),
            Value::Sequence(vec![
                Value::String("8.8.8.8".into()),
                Value::String("https://doh.pub/dns-query".into()),
                Value::String("https://dns.alidns.com/dns-query".into()),
            ]),
        ),
        ("fallback".into(), Value::Sequence(vec![])),
        (
            "nameserver-policy".into(),
            Value::Mapping(serde_yaml::Mapping::new()),
        ),
        (
            "proxy-server-nameserver".into(),
            Value::Sequence(vec![
                Value::String("https://doh.pub/dns-query".into()),
                Value::String("https://dns.alidns.com/dns-query".into()),
                Value::String("tls://223.5.5.5".into()),
            ]),
        ),
        ("direct-nameserver".into(), Value::Sequence(vec![])),
        ("direct-nameserver-follow-policy".into(), Value::Bool(false)),
        (
            "fallback-filter".into(),
            Value::Mapping(serde_yaml::Mapping::from_iter([
                ("geoip".into(), Value::Bool(true)),
                ("geoip-code".into(), Value::String("CN".into())),
                (
                    "ipcidr".into(),
                    Value::Sequence(vec![
                        Value::String("240.0.0.0/4".into()),
                        Value::String("0.0.0.0/32".into()),
                    ]),
                ),
                (
                    "domain".into(),
                    Value::Sequence(vec![
                        Value::String("+.google.com".into()),
                        Value::String("+.facebook.com".into()),
                        Value::String("+.youtube.com".into()),
                    ]),
                ),
            ])),
        ),
    ]);

    // 获取默认DNS和host配置
    let default_dns_config = serde_yaml::Mapping::from_iter([
        ("dns".into(), Value::Mapping(dns_config)),
        ("hosts".into(), Value::Mapping(serde_yaml::Mapping::new())),
    ]);

    // 检查DNS配置文件是否存在
    let app_dir = dirs::app_home_dir()?;
    let dns_path = app_dir.join("dns_config.yaml");

    if !dns_path.exists() {
        log::info!(target: "app", "Creating default DNS config file");
        help::save_yaml(
            &dns_path,
            &default_dns_config,
            Some("# Clash Verge DNS Config"),
        )?;
    }

    Ok(())
}

/// Initialize all the config files
/// before tauri setup
pub fn init_config() -> Result<()> {
    let _ = dirs::init_portable_flag();
    let _ = init_log();
    let _ = delete_log();

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
            help::save_yaml(&path, &IClashTemp::template().0, Some("# Clash Vergeasu"))?;
        }
        <Result<()>>::Ok(())
    }));

    crate::log_err!(dirs::verge_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IVerge::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    // 验证并修正verge.yaml中的clash_core配置
    crate::log_err!(IVerge::validate_and_fix_config());

    crate::log_err!(dirs::profiles_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IProfiles::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    // 初始化DNS配置文件
    let _ = init_dns_config();

    Ok(())
}

/// initialize app resources
/// after tauri setup
pub fn init_resources() -> Result<()> {
    let app_dir = dirs::app_home_dir()?;
    let res_dir = dirs::app_resources_dir()?;

    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    if !res_dir.exists() {
        let _ = fs::create_dir_all(&res_dir);
    }

    let file_list = ["Country.mmdb", "geoip.dat", "geosite.dat"];

    // copy the resource file
    // if the source file is newer than the destination file, copy it over
    for file in file_list.iter() {
        let src_path = res_dir.join(file);
        let dest_path = app_dir.join(file);
        log::debug!(target: "app", "src_path: {src_path:?}, dest_path: {dest_path:?}");

        let handle_copy = |dest: &PathBuf| {
            match fs::copy(&src_path, dest) {
                Ok(_) => log::debug!(target: "app", "resources copied '{file}'"),
                Err(err) => {
                    log::error!(target: "app", "failed to copy resources '{file}' to '{dest:?}', {err}")
                }
            };
        };

        if src_path.exists() && !dest_path.exists() {
            handle_copy(&dest_path);
            continue;
        }

        let src_modified = fs::metadata(&src_path).and_then(|m| m.modified());
        let dest_modified = fs::metadata(&dest_path).and_then(|m| m.modified());

        match (src_modified, dest_modified) {
            (Ok(src_modified), Ok(dest_modified)) => {
                if src_modified > dest_modified {
                    handle_copy(&dest_path);
                } else {
                    log::debug!(target: "app", "skipping resource copy '{file}'");
                }
            }
            _ => {
                log::debug!(target: "app", "failed to get modified '{file}'");
                handle_copy(&dest_path);
            }
        };
    }

    Ok(())
}

/// initialize url scheme
#[cfg(target_os = "windows")]
pub fn init_scheme() -> Result<()> {
    use tauri::utils::platform::current_exe;
    use winreg::{enums::*, RegKey};

    let app_exe = current_exe()?;
    let app_exe = dunce::canonicalize(app_exe)?;
    let app_exe = app_exe.to_string_lossy().into_owned();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (clash, _) = hkcu.create_subkey("Software\\Classes\\Clash")?;
    clash.set_value("", &"Clash Verge")?;
    clash.set_value("URL Protocol", &"Clash Verge URL Scheme Protocol")?;
    let (default_icon, _) = hkcu.create_subkey("Software\\Classes\\Clash\\DefaultIcon")?;
    default_icon.set_value("", &app_exe)?;
    let (command, _) = hkcu.create_subkey("Software\\Classes\\Clash\\Shell\\Open\\Command")?;
    command.set_value("", &format!("{app_exe} \"%1\""))?;

    Ok(())
}
#[cfg(target_os = "linux")]
pub fn init_scheme() -> Result<()> {
    let output = std::process::Command::new("xdg-mime")
        .arg("default")
        .arg("clash-verge.desktop")
        .arg("x-scheme-handler/clash")
        .output()?;
    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "failed to set clash scheme, {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}
#[cfg(target_os = "macos")]
pub fn init_scheme() -> Result<()> {
    Ok(())
}

pub async fn startup_script() -> Result<()> {
    let app_handle = handle::Handle::global().app_handle().unwrap();

    let script_path = {
        let verge = Config::verge();
        let verge = verge.latest_ref();
        verge.startup_script.clone().unwrap_or("".to_string())
    };

    if script_path.is_empty() {
        return Ok(());
    }

    let shell_type = if script_path.ends_with(".sh") {
        "bash"
    } else if script_path.ends_with(".ps1") || script_path.ends_with(".bat") {
        "powershell"
    } else {
        return Err(anyhow::anyhow!(
            "unsupported script extension: {}",
            script_path
        ));
    };

    let script_dir = PathBuf::from(&script_path);
    if !script_dir.exists() {
        return Err(anyhow::anyhow!("script not found: {}", script_path));
    }

    let parent_dir = script_dir.parent();
    let working_dir = parent_dir.unwrap_or(script_dir.as_ref());

    app_handle
        .shell()
        .command(shell_type)
        .current_dir(working_dir)
        .args(&[script_path])
        .output()
        .await?;

    Ok(())
}

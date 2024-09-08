use anyhow::{Error, Result};
use chrono::{Local, TimeZone};
use log::LevelFilter;
use log4rs::{
    append::{console::ConsoleAppender, file::FileAppender},
    config::{Appender, Logger, Root},
    encode::pattern::PatternEncoder,
    Handle,
};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::str::FromStr;
use std::{
    fs::{self, DirEntry},
    sync::Arc,
};

use crate::utils::dirs;

#[derive(Debug)]
pub struct VergeLog {
    log_handle: Arc<Mutex<Option<Handle>>>,
    log_file: Arc<Mutex<Option<String>>>,
}

impl VergeLog {
    pub fn global() -> &'static Self {
        static VERGE_LOG: OnceCell<VergeLog> = OnceCell::new();
        VERGE_LOG.get_or_init(|| VergeLog {
            log_handle: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        })
    }

    /// create log4rs config
    /// 
    /// # Aruguments:
    /// - `log_level`: log level
    /// - `log_file`: log file path, if None, use default log file path
    /// 
    /// # Returns:
    /// - `Option<log4rs::config::Config>`: log4rs config
    fn create_log_config(
        log_level: LevelFilter,
        log_file: Option<String>,
    ) -> Option<log4rs::config::Config> {
        let log_dir = dirs::app_logs_dir().unwrap();
        if !log_dir.exists() {
            let _ = fs::create_dir_all(&log_dir);
        }

        // if log_level == LevelFilter::Off {
        //     return None;
        // }

        let real_log_file = log_file.map_or_else(
            || {
                let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
                let log_file_name = format!("{}.log", local_time);
                log_dir.join(log_file_name)
            },
            |v| v.into(),
        );
        *Self::global().log_file.lock() = Some(real_log_file.to_string_lossy().to_string());

        let log_pattern = match log_level {
            LevelFilter::Trace => "{d(%Y-%m-%d %H:%M:%S)} {l} [{M}] - {m}{n}",
            _ => "{d(%Y-%m-%d %H:%M:%S)} {l} - {m}{n}",
        };

        let encode = Box::new(PatternEncoder::new(log_pattern));

        let stdout = ConsoleAppender::builder().encoder(encode.clone()).build();
        let tofile = FileAppender::builder()
            .encoder(encode)
            .build(real_log_file)
            .unwrap();

        let mut logger_builder = Logger::builder();
        let mut root_builder = Root::builder();

        let log_more = log_level == LevelFilter::Trace || log_level == LevelFilter::Debug;

        #[cfg(feature = "verge-dev")]
        {
            logger_builder = logger_builder.appenders(["file", "stdout"]);
            if log_more {
                root_builder = root_builder.appenders(["file", "stdout"]);
            } else {
                root_builder = root_builder.appenders(["stdout"]);
            }
        }
        #[cfg(not(feature = "verge-dev"))]
        {
            logger_builder = logger_builder.appenders(["file"]);
            if log_more {
                root_builder = root_builder.appenders(["file"]);
            }
        }

        let (config, _) = log4rs::config::Config::builder()
            .appender(Appender::builder().build("stdout", Box::new(stdout)))
            .appender(Appender::builder().build("file", Box::new(tofile)))
            .logger(logger_builder.additive(false).build("app", log_level))
            .build_lossy(root_builder.build(log_level));
        Some(config)
    }

    pub fn init(&self) -> Result<()> {
        let log_level = crate::config::Config::verge().data().get_log_level();
        let config = Self::create_log_config(log_level, None);
        if let Some(config) = config {
            let handle = log4rs::init_config(config)?;
            *self.log_handle.lock() = Some(handle);
        } else {
            *self.log_handle.lock() = None;
        }
        Ok(())
    }

    pub fn update_log_level(log_level: LevelFilter) -> Result<(), Error> {
        let handle = Self::global().log_handle.lock().clone();
        if handle.is_none() {
            anyhow::bail!("log handle is none, please init log first");
        }
        let log_file = Self::global().log_file.lock().clone();
        let config = Self::create_log_config(log_level, log_file);
        if config.is_none() {
            anyhow::bail!("create log config failed");
        }
        handle.unwrap().set_config(config.unwrap());
        Ok(())
    }

    pub fn delete_log() -> Result<()> {
        let log_dir = dirs::app_logs_dir()?;
        if !log_dir.exists() {
            return Ok(());
        }

        let auto_log_clean = {
            let verge = crate::Config::verge();
            let verge = verge.data();
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
}

use crate::config::Config;
use crate::utils::dirs::{self};
use anyhow::{bail, Error, Result};
use chrono::{Local, TimeZone};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::str::FromStr;
use std::{
    fs::{self, DirEntry},
    sync::Arc,
};
use time::macros::format_description;
use tracing::level_filters::LevelFilter;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::{non_blocking, rolling};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::reload::{self, Handle};
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Registry;

#[derive(Debug)]
pub struct VergeLog {
    log_handle: Arc<Mutex<Option<Handle<LevelFilter, Registry>>>>,
    log_file: Arc<Mutex<Option<String>>>,
    service_log_file: Arc<Mutex<Option<String>>>,
}

impl VergeLog {
    pub fn global() -> &'static Self {
        static VERGE_LOG: OnceCell<VergeLog> = OnceCell::new();
        VERGE_LOG.get_or_init(|| VergeLog {
            log_handle: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
            service_log_file: Arc::new(Mutex::new(None)),
        })
    }

    pub fn get_log_file(&self) -> Option<String> {
        self.log_file.lock().clone()
    }

    pub fn get_service_log_file(&self) -> Option<String> {
        self.service_log_file.lock().clone()
    }

    pub fn reset_service_log_file(&self) {
        *self.service_log_file.lock() = None;
    }

    pub fn create_service_log_file(&self) -> Result<String> {
        let service_log_file = dirs::service_log_file()?;
        let service_log_file = service_log_file.to_string_lossy().to_string();
        *self.service_log_file.lock() = Some(service_log_file.clone());
        Ok(service_log_file)
    }

    /// 必须返回 WorkerGuard，并且仅在它的生命周期中，才能写入到日志文件
    ///
    /// 因此，必须确保返回的 WorkerGuard 的生命周期足够长
    pub fn init(&self) -> Result<WorkerGuard> {
        let log_level = Config::verge().latest().get_log_level();
        let timer = tracing_subscriber::fmt::time::LocalTime::new(format_description!(
            "[year]-[month]-[day] [hour]:[minute]:[second]"
        ));
        // 输出到终端
        let (filter, reload_handle) = reload::Layer::new(log_level);
        let console_layer = tracing_subscriber::fmt::layer()
            .compact()
            .with_ansi(true)
            .with_timer(timer.clone())
            .with_line_number(true)
            .with_writer(std::io::stdout);

        // 输出到日志文件
        let log_dir = dirs::app_logs_dir()?;
        let local_time = Local::now().format("%Y-%m-%d-%H%M").to_string();
        let log_file_name = format!("{}.log", local_time);
        let file_appender = rolling::never(log_dir, log_file_name);
        let (non_blocking_appender, guard) = non_blocking(file_appender);
        let file_layer = tracing_subscriber::fmt::layer()
            .compact()
            .with_ansi(false)
            .with_timer(timer)
            .with_line_number(true)
            .with_writer(non_blocking_appender);

        tracing_subscriber::registry()
            .with(filter)
            .with(console_layer)
            .with(file_layer)
            .init();

        *self.log_handle.lock() = Some(reload_handle);

        Ok(guard)
    }

    pub fn update_log_level(log_level: LevelFilter) -> Result<(), Error> {
        let handle = Self::global().log_handle.lock();
        if let Some(handle) = handle.as_ref() {
            handle.modify(|filter| *filter = log_level)?;
        } else {
            bail!("log handle is none, please init log first");
        }
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

        tracing::debug!("try to delete log files, day: {day}");

        // %Y-%m-%d to NaiveDateTime
        let parse_time_str = |s: &str| {
            let sa = s.split('-').collect::<Vec<&str>>();
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
                    tracing::info!("delete log file: {file_name}");
                }
            }
            Ok(())
        };

        for file in fs::read_dir(&log_dir)?.flatten() {
            let _ = process_file(file);
        }

        let service_log_dir = log_dir.join("service");
        if service_log_dir.exists() {
            for file in fs::read_dir(service_log_dir)?.flatten() {
                let _ = process_file(file);
            }
        }

        Ok(())
    }
}

use std::borrow::Cow;
use std::{fmt, sync::Arc};
use std::{io::Write, thread};

use flexi_logger::DeferredNow;
use flexi_logger::filter::LogLineFilter;
use flexi_logger::writers::FileLogWriter;
use flexi_logger::writers::LogWriter as _;
use log::Level;
use log::{LevelFilter, Record};
#[cfg(feature = "color")]
use nu_ansi_term::Color;
use tokio::sync::{RwLock, RwLockReadGuard};

pub type SharedWriter = Arc<RwLock<FileLogWriter>>;

#[derive(Debug, PartialEq, Eq)]
pub enum Type {
    Cmd,
    Core,
    Config,
    Setup,
    System,
    SystemSignal,
    Service,
    Hotkey,
    Window,
    Tray,
    Timer,
    Frontend,
    Backup,
    File,
    Lightweight,
    Network,
    ProxyMode,
    Validate,
    ClashVergeRev,
}

impl fmt::Display for Type {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cmd => write!(f, "[Cmd]"),
            Self::Core => write!(f, "[Core]"),
            Self::Config => write!(f, "[Config]"),
            Self::Setup => write!(f, "[Setup]"),
            Self::System => write!(f, "[System]"),
            Self::SystemSignal => write!(f, "[SysSignal]"),
            Self::Service => write!(f, "[Service]"),
            Self::Hotkey => write!(f, "[Hotkey]"),
            Self::Window => write!(f, "[Window]"),
            Self::Tray => write!(f, "[Tray]"),
            Self::Timer => write!(f, "[Timer]"),
            Self::Frontend => write!(f, "[Frontend]"),
            Self::Backup => write!(f, "[Backup]"),
            Self::File => write!(f, "[File]"),
            Self::Lightweight => write!(f, "[Lightweight]"),
            Self::Network => write!(f, "[Network]"),
            Self::ProxyMode => write!(f, "[ProxMode]"),
            Self::Validate => write!(f, "[Validate]"),
            Self::ClashVergeRev => write!(f, "[ClashVergeRev]"),
        }
    }
}

#[macro_export]
macro_rules! logging {
    // 不带 print 参数的版本（默认不打印）
    ($level:ident, $type:expr, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*))
    };
}

#[macro_export]
macro_rules! logging_error {
    // Handle Result<T, E>
    ($type:expr, $expr:expr) => {
        if let Err(err) = $expr {
            log::error!(target: "app", "[{}] {}", $type, err);
        }
    };

    // Handle formatted message: always print to stdout and log as error
    ($type:expr, $fmt:literal $(, $arg:expr)*) => {
        log::error!(target: "app", "[{}] {}", $type, format_args!($fmt $(, $arg)*));
    };
}

#[inline]
pub fn write_sidecar_log(
    writer: RwLockReadGuard<'_, FileLogWriter>,
    now: &mut DeferredNow,
    level: Level,
    message: &str,
) {
    let args = format_args!("{}", message);

    let record = Record::builder().args(args).level(level).target("sidecar").build();

    let _ = writer.write(now, &record);
}

pub struct NoModuleFilter<'a>(pub Vec<&'a str>);

impl<'a> NoModuleFilter<'a> {
    #[inline]
    pub fn filter(&self, record: &Record) -> bool {
        if let Some(module) = record.module_path() {
            for blocked in self.0.iter() {
                if module.len() >= blocked.len() && module.as_bytes()[..blocked.len()] == blocked.as_bytes()[..] {
                    return false;
                }
            }
        }
        true
    }
}

impl<'a> LogLineFilter for NoModuleFilter<'a> {
    #[inline]
    fn write(
        &self,
        now: &mut DeferredNow,
        record: &Record,
        writer: &dyn flexi_logger::filter::LogLineWriter,
    ) -> std::io::Result<()> {
        if !self.filter(record) {
            return Ok(());
        }
        writer.write(now, record)
    }
}

pub fn level_filter_to_string(log_level: &LevelFilter) -> Cow<'static, str> {
    #[cfg(feature = "color")]
    {
        match log_level {
            LevelFilter::Off => Cow::Owned(Color::Fixed(8).paint("OFF").to_string()),
            LevelFilter::Error => Cow::Owned(Color::Red.paint("ERROR").to_string()),
            LevelFilter::Warn => Cow::Owned(Color::Yellow.paint("WARN ").to_string()),
            LevelFilter::Info => Cow::Owned(Color::Green.paint("INFO ").to_string()),
            LevelFilter::Debug => Cow::Owned(Color::Blue.paint("DEBUG").to_string()),
            LevelFilter::Trace => Cow::Owned(Color::Purple.paint("TRACE").to_string()),
        }
    }
    #[cfg(not(feature = "color"))]
    {
        match log_level {
            LevelFilter::Off => Cow::Borrowed("OFF"),
            LevelFilter::Error => Cow::Borrowed("ERROR"),
            LevelFilter::Warn => Cow::Borrowed("WARN "),
            LevelFilter::Info => Cow::Borrowed("INFO "),
            LevelFilter::Debug => Cow::Borrowed("DEBUG"),
            LevelFilter::Trace => Cow::Borrowed("TRACE"),
        }
    }
}

pub fn console_format(w: &mut dyn Write, now: &mut DeferredNow, record: &Record) -> std::io::Result<()> {
    let current_thread = thread::current();
    let thread_name = current_thread.name().unwrap_or("unnamed");

    let level = level_filter_to_string(&record.level().to_level_filter());

    let now = now.format("%H:%M:%S%.3f");
    #[cfg(feature = "color")]
    let now = Color::DarkGray.paint(Cow::from(now.to_string()));

    let line = record.line().map_or(0, |l| l);
    let module = record.module_path().unwrap_or("<unnamed>");
    let module_line = Cow::from(format!("{}:{}", module, line));

    #[cfg(feature = "color")]
    let module_line = Color::Purple.paint(module_line);

    let thread_name = Cow::from(format!("T{{{}}}", thread_name));
    #[cfg(feature = "color")]
    let thread_name = Color::Cyan.paint(thread_name);

    write!(w, "{} {} {} {} {}", now, level, module_line, thread_name, record.args(),)
}

pub fn file_format_with_level(w: &mut dyn Write, now: &mut DeferredNow, record: &Record) -> std::io::Result<()> {
    write!(
        w,
        "[{}] {} {}",
        now.format("%Y-%m-%d %H:%M:%S%.3f"),
        record.level(),
        record.args(),
    )
}

pub fn file_format_without_level(w: &mut dyn Write, now: &mut DeferredNow, record: &Record) -> std::io::Result<()> {
    write!(w, "[{}] {}", now.format("%Y-%m-%d %H:%M:%S%.3f"), record.args(),)
}

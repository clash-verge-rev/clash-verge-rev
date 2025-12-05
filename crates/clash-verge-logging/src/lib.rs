use compact_str::CompactString;
use flexi_logger::DeferredNow;
#[cfg(not(feature = "tauri-dev"))]
use flexi_logger::filter::LogLineFilter;
use flexi_logger::writers::FileLogWriter;
use flexi_logger::writers::LogWriter as _;
use log::Level;
use log::Record;
use std::{fmt, sync::Arc};
use tokio::sync::{Mutex, MutexGuard};

pub type SharedWriter = Arc<Mutex<FileLogWriter>>;

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
    writer: MutexGuard<'_, FileLogWriter>,
    now: &mut DeferredNow,
    level: Level,
    message: &CompactString,
) {
    let args = format_args!("{}", message);

    let record = Record::builder()
        .args(args)
        .level(level)
        .target("sidecar")
        .build();

    let _ = writer.write(now, &record);
}

#[cfg(not(feature = "tauri-dev"))]
pub struct NoModuleFilter<'a>(pub &'a [&'a str]);

#[cfg(not(feature = "tauri-dev"))]
impl<'a> NoModuleFilter<'a> {
    #[inline]
    pub fn filter(&self, record: &Record) -> bool {
        if let Some(module) = record.module_path() {
            for blocked in self.0 {
                if module.len() >= blocked.len()
                    && module.as_bytes()[..blocked.len()] == blocked.as_bytes()[..]
                {
                    return false;
                }
            }
        }
        true
    }
}

#[cfg(not(feature = "tauri-dev"))]
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

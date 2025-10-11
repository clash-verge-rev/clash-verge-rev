use flexi_logger::writers::FileLogWriter;
#[cfg(not(feature = "tauri-dev"))]
use flexi_logger::{DeferredNow, filter::LogLineFilter};
#[cfg(not(feature = "tauri-dev"))]
use log::Record;
use std::{fmt, sync::Arc};
use tokio::sync::Mutex;

pub type SharedWriter = Arc<Mutex<FileLogWriter>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    Cmd,
    Core,
    Config,
    Setup,
    System,
    Service,
    Hotkey,
    Window,
    Tray,
    Timer,
    Frontend,
    Backup,
    Lightweight,
    Network,
    ProxyMode,
    // Cache,
    ClashVergeRev,
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Cmd => write!(f, "[Cmd]"),
            Type::Core => write!(f, "[Core]"),
            Type::Config => write!(f, "[Config]"),
            Type::Setup => write!(f, "[Setup]"),
            Type::System => write!(f, "[System]"),
            Type::Service => write!(f, "[Service]"),
            Type::Hotkey => write!(f, "[Hotkey]"),
            Type::Window => write!(f, "[Window]"),
            Type::Tray => write!(f, "[Tray]"),
            Type::Timer => write!(f, "[Timer]"),
            Type::Frontend => write!(f, "[Frontend]"),
            Type::Backup => write!(f, "[Backup]"),
            Type::Lightweight => write!(f, "[Lightweight]"),
            Type::Network => write!(f, "[Network]"),
            Type::ProxyMode => write!(f, "[ProxMode]"),
            // Type::Cache => write!(f, "[Cache]"),
            Type::ClashVergeRev => write!(f, "[ClashVergeRev]"),
        }
    }
}

#[macro_export]
macro_rules! error {
    ($result: expr) => {
        log::error!(target: "app", "{}", $result);
    };
}

#[macro_export]
macro_rules! log_err {
    ($result: expr) => {
        if let Err(err) = $result {
            log::error!(target: "app", "{err}");
        }
    };

    ($result: expr, $err_str: expr) => {
        if let Err(_) = $result {
            log::error!(target: "app", "{}", $err_str);
        }
    };
}

#[macro_export]
macro_rules! trace_err {
    ($result: expr, $err_str: expr) => {
        if let Err(err) = $result {
            log::trace!(target: "app", "{}, err {}", $err_str, err);
        }
    }
}

/// wrap the anyhow error
/// transform the error to String
#[macro_export]
macro_rules! wrap_err {
    // Case 1: Future<Result<T, E>>
    ($stat:expr, async) => {{
        match $stat.await {
            Ok(a) => Ok(a),
            Err(err) => {
                log::error!(target: "app", "{}", err);
                Err(err.to_string())
            }
        }
    }};

    // Case 2: Result<T, E>
    ($stat:expr) => {{
        match $stat {
            Ok(a) => Ok(a),
            Err(err) => {
                log::error!(target: "app", "{}", err);
                Err(err.to_string())
            }
        }
    }};
}

#[macro_export]
macro_rules! logging {
    // 不带 print 参数的版本（默认不打印）
    ($level:ident, $type:expr, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
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

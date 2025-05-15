use std::fmt;

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
    ($stat: expr) => {
        match $stat {
            Ok(a) => Ok(a),
            Err(err) => {
                log::error!(target: "app", "{}", err.to_string());
                Err(format!("{}", err.to_string()))
            }
        }
    };
}

#[macro_export]
macro_rules! logging {
    // 带 println 的版本（支持格式化参数）
    ($level:ident, $type:expr, true, $($arg:tt)*) => {
        println!("{} {}", $type, format_args!($($arg)*));
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };

    // 带 println 的版本（使用 false 明确不打印）
    ($level:ident, $type:expr, false, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };

    // 不带 print 参数的版本（默认不打印）
    ($level:ident, $type:expr, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };
}

#[macro_export]
macro_rules! logging_error {
    // 1. 处理 Result<T, E>，带打印控制
    ($type:expr, $print:expr, $expr:expr) => {
        match $expr {
            Ok(_) => {},
            Err(err) => {
                if $print {
                    println!("[{}] Error: {}", $type, err);
                }
                log::error!(target: "app", "[{}] {}", $type, err);
            }
        }
    };

    // 2. 处理 Result<T, E>，默认不打印
    ($type:expr, $expr:expr) => {
        if let Err(err) = $expr {
            log::error!(target: "app", "[{}] {}", $type, err);
        }
    };

    // 3. 处理格式化字符串，带打印控制
    ($type:expr, $print:expr, $fmt:literal $(, $arg:expr)*) => {
        if $print {
            println!("[{}] {}", $type, format_args!($fmt $(, $arg)*));
        }
        log::error!(target: "app", "[{}] {}", $type, format_args!($fmt $(, $arg)*));
    };

    // 4. 处理格式化字符串，不带 bool 时，默认 `false`
    ($type:expr, $fmt:literal $(, $arg:expr)*) => {
        logging_error!($type, false, $fmt $(, $arg)*);
    };
}

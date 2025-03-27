use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    Core,
    Service,
    Hotkey,
    Window,
    Config,
    CMD,
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Core => write!(f, "[Core]"),
            Type::Service => write!(f, "[Service]"),
            Type::Hotkey => write!(f, "[Hotkey]"),
            Type::Window => write!(f, "[Window]"),
            Type::Config => write!(f, "[Config]"),
            Type::CMD => write!(f, "[CMD]"),
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
    ($level:ident, $type:expr, $print:expr, $($arg:tt)*) => {
        println!("{} {}", $type, format_args!($($arg)*));
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };

    // 不带 println 的版本
    ($level:ident, $type:expr, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };
}

#[macro_export]
macro_rules! logging_error {
    // Version with println and Result expression
    ($type:expr, $print:expr, $expr:expr) => {
        match $expr {
            Ok(_) => {},
            Err(err) => {
                if $print {
                    println!("[{}] Error: {}", $type, err);
                }
                log::error!(target: "app", "{} {}", $type, err);
            }
        }
    };

    // Version without println and Result expression
    ($type:expr, $expr:expr) => {
        if let Err(err) = $expr {
            log::error!(target: "app", "{} {}", $type, err);
        }
    };

    // Version with println and custom message
    ($type:expr, $print:expr, $($arg:tt)*) => {
        if $print {
            println!("[{}] {}", $type, format_args!($($arg)*));
        }
        log::error!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };

    // Version without println and custom message
    ($type:expr, $($arg:tt)*) => {
        log::error!(target: "app", "{} {}", $type, format_args!($($arg)*));
    };
}

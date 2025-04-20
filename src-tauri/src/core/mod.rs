pub mod backup;
#[allow(clippy::module_inception)]
mod core;
pub mod handle;
pub mod hotkey;
pub mod logger;
pub mod manager;
pub mod service;
pub mod sysopt;
pub mod timer;
pub mod tray;
pub mod verge_log;
#[cfg(target_os = "windows")]
pub mod win_uwp;

pub use self::core::*;

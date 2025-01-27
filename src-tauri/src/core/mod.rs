pub mod backup;
pub mod mihomo;
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
pub mod win_uwp;

pub use self::core::*;

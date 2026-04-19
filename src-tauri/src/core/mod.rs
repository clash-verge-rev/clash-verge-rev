pub mod autostart;
pub mod backup;
pub mod handle;
pub mod hotkey;
pub mod logger;
pub mod manager;
mod notification;
pub mod service;
pub mod sysopt;
#[cfg(target_os = "macos")]
pub mod sysproxy_helper;
#[cfg(target_os = "macos")]
pub mod sysproxy_helper_bridge;
pub mod timer;
pub mod tray;
pub mod updater;
pub mod validate;
pub mod win_uwp;

pub use self::{manager::CoreManager, timer::Timer, updater::SilentUpdater};

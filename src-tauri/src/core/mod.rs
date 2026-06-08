pub mod autostart;
pub mod backup;
pub mod handle;
pub mod hotkey;
pub mod logger;
pub mod manager;
mod notification;
pub mod service;
pub mod sysopt;
pub mod timer;
pub mod tray;
// FreeBSD: tauri has not ported the updater component, disable the entire updater module.
#[cfg(not(target_os = "freebsd"))]
pub mod updater;
pub mod validate;
pub mod win_uwp;

#[cfg(not(target_os = "freebsd"))]
pub use self::{manager::CoreManager, timer::Timer, updater::SilentUpdater};
#[cfg(target_os = "freebsd")]
pub use self::{manager::CoreManager, timer::Timer};

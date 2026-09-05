pub mod autostart;
pub mod backup;
pub mod handle;
pub mod hotkey;
pub mod listener;
pub mod logger;
#[cfg(target_os = "macos")]
pub(crate) mod macos_service;
pub mod manager;
#[cfg(target_os = "macos")]
pub mod network_watch;
pub mod notification;
pub(crate) mod owner_identity;
pub mod proxy_control;
pub mod proxy_view;
pub mod runstate;
mod runtime_bundle;
pub mod service;
pub mod sysopt;
pub mod timer;
pub mod tray;
pub mod updater;
pub mod validate;
pub mod win_uwp;

pub use self::{manager::CoreManager, timer::Timer, updater::SilentUpdater};

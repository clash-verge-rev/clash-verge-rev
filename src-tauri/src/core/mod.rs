pub mod backup;
#[allow(clippy::module_inception)]
mod core;
pub mod handle;
pub mod hotkey;
pub mod service;
pub mod service_ipc;
pub mod sysopt;
pub mod timer;
pub mod tray;
pub mod win_uwp;

pub use self::{core::*, timer::Timer};

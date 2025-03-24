use anyhow::Result;

// Common result type used by command functions
pub type CmdResult<T = ()> = Result<T, String>;

// Command modules
pub mod app;
pub mod clash;
pub mod core;
pub mod media_unlock_checker;
pub mod network;
pub mod profile;
pub mod proxy;
pub mod runtime;
pub mod save_profile;
pub mod system;
pub mod uwp;
pub mod validate;
pub mod verge;
pub mod webdav;
pub mod lighteweight;

// Re-export all command functions for backwards compatibility
pub use app::*;
pub use clash::*;
pub use core::*;
pub use media_unlock_checker::*;
pub use network::*;
pub use profile::*;
pub use proxy::*;
pub use runtime::*;
pub use save_profile::*;
pub use system::*;
pub use uwp::*;
pub use validate::*;
pub use verge::*;
pub use webdav::*;
pub use lighteweight::*;

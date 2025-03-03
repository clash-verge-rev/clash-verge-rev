use anyhow::Result;

// Common result type used by command functions
pub type CmdResult<T = ()> = Result<T, String>;

// Command modules
pub mod profile;
pub mod validate;
pub mod uwp;
pub mod webdav;
pub mod app;
pub mod network;
pub mod clash;
pub mod verge;
pub mod runtime;
pub mod save_profile;
pub mod system;
pub mod proxy;

// Re-export all command functions for backwards compatibility
pub use profile::*;
pub use validate::*;
pub use uwp::*;
pub use webdav::*;
pub use app::*;
pub use network::*;
pub use clash::*;
pub use verge::*;
pub use runtime::*;
pub use save_profile::*;
pub use system::*;
pub use proxy::*;
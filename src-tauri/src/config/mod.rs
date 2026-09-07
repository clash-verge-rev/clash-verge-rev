mod clash;
#[allow(clippy::module_inception)]
mod config;
mod encrypt;
mod mixed_port;
mod port;
mod prfitem;
pub mod profiles;
pub mod runtime;
pub(crate) mod snapshot;
mod verge;

pub(crate) use self::config::{Config, ConfigType};
pub use self::{clash::*, encrypt::*, mixed_port::*, prfitem::*, profiles::*, verge::*};

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;

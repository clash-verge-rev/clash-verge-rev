mod clash;
#[allow(clippy::module_inception)]
mod config;
mod draft;
mod encrypt;
mod prfitem;
mod profiles;
mod runtime;
mod verge;

pub use self::{
    clash::*, config::*, draft::*, encrypt::*, prfitem::*, profiles::*, runtime::*, verge::*,
};

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;

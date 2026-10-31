mod clash;
#[allow(clippy::module_inception)]
mod config;
pub(crate) mod dns;
mod encrypt;
mod mixed_port;
mod port;
mod prfitem;
pub mod profiles;
pub mod runtime;
pub(crate) mod snapshot;
mod verge;

pub(crate) use self::config::Config;
pub use self::{clash::*, encrypt::*, mixed_port::*, prfitem::*, profiles::*, verge::*};

macro_rules! patch_opt_field {
    ($lv:expr, $rv:expr, $key:tt) => {
        if ($rv.$key).is_some() {
            $lv.$key = $rv.$key.clone();
        }
    };
}
pub(crate) use patch_opt_field;

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;

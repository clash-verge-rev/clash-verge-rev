mod clash;
#[allow(clippy::module_inception)]
mod config;
mod draft;
mod prfitem;
mod profiles;
mod runtime;
mod verge;

pub use self::clash::*;
pub use self::config::*;
pub use self::draft::*;
pub use self::prfitem::*;
pub use self::profiles::*;
pub use self::runtime::*;
pub use self::verge::*;

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;

pub const CLASH_BASIC_CONFIG: [&str; 22] = [
    "port",
    "socks-port",
    "redir-port",
    "tproxy-port",
    "mixed-port",
    "tun",
    "tuic-server",
    "ss-config",
    "vmess-config",
    "tcptun-config",
    "udptun-config",
    "allow-lan",
    "skip-auth-prefixes",
    "lan-allowed-ips",
    "lan-disallowed-ips",
    "bind-address",
    "mode",
    "log-level",
    "ipv6",
    "sniffing",
    "tcp-concurrent",
    "interface-name",
];

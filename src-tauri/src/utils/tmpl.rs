///! Some config file template

/// template for clash core `config.yaml`
pub const CLASH_CONFIG: &[u8] = br#"# Default Config For Clash Core

mixed-port: 7890
log-level: info
allow-lan: false
external-controller: 127.0.0.1:9090
mode: rule
secret: ""
"#;

/// template for `profiles.yaml`
pub const PROFILES_CONFIG: &[u8] = b"# Profiles Config for Clash Verge

current: 0
items: ~
";

/// template for `verge.yaml`
pub const VERGE_CONFIG: &[u8] = b"# Defaulf Config For Clash Verge

theme_mode: light
theme_blur: false
traffic_graph: true
enable_self_startup: false
enable_system_proxy: false
enable_proxy_guard: false
proxy_guard_duration: 10
system_proxy_bypass: localhost;127.*;10.*;192.168.*;<local>
";

/// template for new a profile item
pub const ITEM_CONFIG: &[u8] = b"# Profile Template for clash verge\n\n
# proxies defination (optional, the same as clash)
proxies:\n
# proxy-groups (optional, the same as clash)
proxy-groups:\n
# rules (optional, the same as clash)
rules:\n\n
";

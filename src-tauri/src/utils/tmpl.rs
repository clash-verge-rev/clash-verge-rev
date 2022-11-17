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

current: ~
chain: ~
valid:
  - dns
items: ~
";

/// template for `verge.yaml`
pub const VERGE_CONFIG: &[u8] = b"# Default Config For Clash Verge

clash_core: clash
language: en
theme_mode: system
theme_blur: false
traffic_graph: true
enable_auto_launch: false
enable_silent_start: false
enable_system_proxy: false
enable_proxy_guard: false
proxy_guard_duration: 10
auto_close_connection: true
";

/// template for new a profile item
pub const ITEM_LOCAL: &str = "# Profile Template for clash verge

proxies:

proxy-groups:

rules:
";

/// enhanced profile
pub const ITEM_MERGE: &str = "# Merge Template for clash verge
# The `Merge` format used to enhance profile

prepend-rules:

prepend-proxies:

prepend-proxy-groups:

append-rules:

append-proxies:

append-proxy-groups:
";

/// enhanced profile
pub const ITEM_SCRIPT: &str = "// Define the `main` function

function main(params) {
  return params;
}
";

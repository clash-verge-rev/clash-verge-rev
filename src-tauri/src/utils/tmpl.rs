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
items: ~
";

/// template for `verge.yaml`
pub const VERGE_CONFIG: &[u8] = b"# Defaulf Config For Clash Verge

language: en
theme_mode: light
theme_blur: false
traffic_graph: true
enable_self_startup: false
enable_system_proxy: false
enable_proxy_guard: false
proxy_guard_duration: 10
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
// The argument to this function is the clash config 
// or the result of the previous handler
// so you should return the config after processing
function main(params) {
  return params;
}
";

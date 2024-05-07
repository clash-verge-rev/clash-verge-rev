//! Some config file template

/// template for new a profile item
pub const ITEM_LOCAL: &str = "# Profile Template for Clash Verge

proxies: []

proxy-groups: []

rules: []
";

/// enhanced profile
pub const ITEM_MERGE: &str = "# Profile Enhancement Merge Template for Clash Verge

prepend-rules: []

prepend-proxies: []

prepend-proxy-groups: []

append-rules: []

append-proxies: []

append-proxy-groups: []
";

/// enhanced profile
pub const ITEM_SCRIPT: &str = "// Define main function (script entry)

function main(config) {
  return config;
}
";

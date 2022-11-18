///! Some config file template

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

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use smartstring::alias::String;

#[derive(Default, Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RoutingPolicy {
    #[default]
    Manual,
    Fixed,
    Auto,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileRoute {
    pub profile: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub exact_domains: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default)]
    pub policy: RoutingPolicy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(default)]
    pub regions: Vec<String>,
}

const fn enabled_by_default() -> bool {
    true
}

pub fn normalize_domain(input: &str) -> Result<String> {
    let input = input.trim();
    let host =
        if input.to_ascii_lowercase().starts_with("http://") || input.to_ascii_lowercase().starts_with("https://") {
            let url = reqwest::Url::parse(input)?;
            if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
                bail!("route URL must be HTTP(S) without credentials");
            }
            url.host_str()
                .ok_or_else(|| anyhow::anyhow!("route URL has no host"))?
                .to_owned()
        } else {
            input.to_owned()
        };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<_> = host.split('.').collect();
    if host.len() > 253
        || labels.len() < 2
        || host.parse::<std::net::IpAddr>().is_ok()
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        bail!("route must contain a valid domain name");
    }
    Ok(host.into())
}

impl Default for ProfileRoute {
    fn default() -> Self {
        Self {
            profile: String::new(),
            enabled: true,
            domains: Vec::new(),
            exact_domains: Vec::new(),
            port: None,
            policy: RoutingPolicy::Manual,
            node: None,
            regions: Vec::new(),
        }
    }
}

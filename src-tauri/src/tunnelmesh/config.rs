//! Configuration owned by the embedded TunnelMesh client.
//!
//! The file deliberately keeps the same top-level shape as the reference
//! TunnelMesh client.  The Clash Verge specific enable switch lives in
//! `verge.yaml`; keeping it out of this file lets the configuration remain
//! portable and makes accidental secret copying into Mihomo impossible.

use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::Value;
use std::{
    collections::{BTreeMap, HashSet},
    net::IpAddr,
    path::Path,
};
use tokio::io::AsyncWriteExt as _;

const DEFAULT_MODE: &str = "local";

/// Configuration as persisted in `tunnelmesh.yaml`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct TunnelMeshConfig {
    pub mode: String,
    pub client: TunnelMeshClientConfig,
    /// Preserve future-compatible top-level fields when reading and writing.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for TunnelMeshConfig {
    fn default() -> Self {
        Self {
            mode: DEFAULT_MODE.to_owned(),
            client: TunnelMeshClientConfig::default(),
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct TunnelMeshClientConfig {
    pub server_url: String,
    /// Serialized for the managed file, but never exposed by snapshots.
    pub token: String,
    pub tunnels: Vec<TunnelMeshTunnelConfig>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct TunnelMeshTunnelConfig {
    pub name: String,
    pub protocol: String,
    #[serde(rename = "listen")]
    pub listen_addr: String,
    pub agent_id: String,
    pub auth_mode: String,
    pub allow_remote: bool,
    pub auth_url: String,
    pub target_host: String,
    pub target_port: u16,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for TunnelMeshTunnelConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            protocol: String::new(),
            listen_addr: String::new(),
            agent_id: String::new(),
            auth_mode: "none".to_owned(),
            allow_remote: false,
            auth_url: String::new(),
            target_host: String::new(),
            target_port: 0,
            extra: BTreeMap::new(),
        }
    }
}

/// A display-safe view returned to the UI and status APIs.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TunnelMeshConfigSnapshot {
    pub mode: String,
    pub client: TunnelMeshClientSnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TunnelMeshClientSnapshot {
    pub server_url: String,
    pub token_configured: bool,
    pub tunnels: Vec<TunnelMeshTunnelSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TunnelMeshTunnelSnapshot {
    pub name: String,
    pub protocol: String,
    pub listen: String,
    pub agent_id: String,
    pub auth_mode: String,
    pub allow_remote: bool,
    pub auth_url: String,
    pub target_host: String,
    pub target_port: u16,
}

impl TunnelMeshConfig {
    pub fn redacted_snapshot(&self) -> TunnelMeshConfigSnapshot {
        TunnelMeshConfigSnapshot {
            mode: self.mode.clone(),
            client: TunnelMeshClientSnapshot {
                server_url: self.client.server_url.clone(),
                token_configured: !self.client.token.trim().is_empty(),
                tunnels: self
                    .client
                    .tunnels
                    .iter()
                    .map(|tunnel| TunnelMeshTunnelSnapshot {
                        name: tunnel.name.clone(),
                        protocol: tunnel.protocol.clone(),
                        listen: tunnel.listen_addr.clone(),
                        agent_id: tunnel.agent_id.clone(),
                        auth_mode: tunnel.auth_mode.clone(),
                        allow_remote: tunnel.allow_remote,
                        auth_url: tunnel.auth_url.clone(),
                        target_host: tunnel.target_host.clone(),
                        target_port: tunnel.target_port,
                    })
                    .collect(),
            },
        }
    }

    /// Validate values before a file is written or a runtime is started.
    pub fn validate(&self) -> Result<()> {
        let mode = self.mode.trim();
        if !mode.is_empty() && mode != DEFAULT_MODE {
            bail!("unsupported TunnelMesh mode {mode:?}");
        }
        validate_server_url(&self.client.server_url)?;
        if self.client.token.trim().is_empty() {
            bail!("client.token is required");
        }
        if self.client.tunnels.is_empty() {
            bail!("client.tunnels must contain at least one tunnel");
        }

        let mut listeners = HashSet::new();
        let mut names = HashSet::new();
        for (index, tunnel) in self.client.tunnels.iter().enumerate() {
            validate_tunnel(index, tunnel, &mut listeners, &mut names)?;
        }
        Ok(())
    }

    pub async fn load(path: &Path) -> Result<Self> {
        let bytes = match tokio::fs::read(path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error).with_context(|| format!("failed to read {}", path.display())),
        };
        let config = serde_yaml_ng::from_slice::<Self>(&bytes)
            .with_context(|| format!("failed to parse TunnelMesh YAML {}", path.display()))?;
        Ok(config)
    }

    pub async fn load_from_app_dir() -> Result<Self> {
        let path = crate::utils::dirs::tunnelmesh_config_path()?;
        if path.exists() {
            return Self::load(&path).await;
        }

        // The tray client historically stored this file under the user's
        // XDG-style config directory. Import it once so enabling the embedded
        // client preserves the user's existing routes and token.
        let legacy = ::dirs::home_dir().map(|home| home.join(".config/tunnelmesh/client.yaml"));
        if let Some(legacy) = legacy.filter(|candidate| candidate.exists()) {
            let config = Self::load(&legacy).await?;
            config.save(&path).await?;
            return Ok(config);
        }
        Ok(Self::default())
    }

    /// Atomically replace a config file and force owner-only permissions.
    pub async fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let yaml = serde_yaml_ng::to_string(self).context("failed to serialize TunnelMesh config")?;
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;

        let temporary = path.with_extension(format!("tmp-{}", nanoid::nanoid!()));
        let mut file = tokio::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .with_context(|| format!("failed to create {}", temporary.display()))?;
        let result = async {
            set_owner_only_permissions(&file).await?;
            file.write_all(yaml.as_bytes()).await?;
            file.flush().await?;
            drop(file);
            tokio::fs::rename(&temporary, path).await
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
        }
        result.with_context(|| format!("failed to atomically replace {}", path.display()))
    }
}

async fn set_owner_only_permissions(file: &tokio::fs::File) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600)).await
    }
    #[cfg(not(unix))]
    {
        let _ = file;
        Ok(())
    }
}

fn validate_server_url(raw: &str) -> Result<()> {
    let url = reqwest::Url::parse(raw.trim()).context("client.server_url must be a valid URL")?;
    if !matches!(url.scheme(), "ws" | "wss") || url.host_str().is_none() {
        bail!("client.server_url must use ws:// or wss:// and include a host");
    }
    Ok(())
}

fn validate_tunnel(
    index: usize,
    tunnel: &TunnelMeshTunnelConfig,
    listeners: &mut HashSet<String>,
    names: &mut HashSet<String>,
) -> Result<()> {
    let label = if tunnel.name.trim().is_empty() {
        format!("tunnel {}", index + 1)
    } else {
        format!("tunnel {:?}", tunnel.name.trim())
    };
    let protocol = tunnel.protocol.trim().to_ascii_lowercase();
    if !matches!(protocol.as_str(), "tcp" | "udp" | "http" | "socks5" | "http-proxy") {
        bail!("{label} has unsupported protocol {:?}", tunnel.protocol);
    }
    if !tunnel.name.trim().is_empty() && !names.insert(tunnel.name.trim().to_owned()) {
        bail!("duplicate tunnel name {:?}", tunnel.name.trim());
    }
    if tunnel.agent_id.trim().is_empty() {
        bail!("{label} requires agent_id");
    }
    let listen = tunnel.listen_addr.trim();
    let (host, port, loopback) =
        parse_listen(listen).with_context(|| format!("{label} listen must be a valid host:port address"))?;
    let normalized = format!("{}:{}", host.to_ascii_lowercase(), port);
    if !listeners.insert(normalized) {
        bail!("duplicate tunnel listen address {:?}", listen);
    }

    let auth = if tunnel.auth_mode.trim().is_empty() {
        "none"
    } else {
        tunnel.auth_mode.trim()
    };
    let allowed_auth = match protocol.as_str() {
        "socks5" => ["none", "password"].as_slice(),
        "http-proxy" => ["none", "basic"].as_slice(),
        _ => ["none"].as_slice(),
    };
    if !allowed_auth.contains(&auth) {
        bail!("{label} has unsupported auth_mode {:?}", tunnel.auth_mode);
    }

    if !loopback {
        let mut public_errors = Vec::new();
        if !tunnel.allow_remote {
            public_errors.push("requires allow_remote");
        }
        if protocol == "socks5" && auth != "password" {
            public_errors.push("requires password auth");
        }
        if protocol == "http-proxy" && auth != "basic" {
            public_errors.push("requires basic auth");
        }
        if !public_errors.is_empty() {
            bail!("{label} non-loopback tunnel {}", public_errors.join(" and "));
        }
    }
    if matches!(protocol.as_str(), "tcp" | "udp" | "http")
        && (tunnel.target_host.trim().is_empty() || tunnel.target_port == 0)
    {
        bail!("{label} requires target_host and target_port");
    }
    Ok(())
}

const fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

fn parse_listen(raw: &str) -> Result<(String, u16, bool)> {
    let (host, port) = if let Some(rest) = raw.strip_prefix('[') {
        let (host, port) = rest.split_once("]:").ok_or_else(|| anyhow::anyhow!("missing port"))?;
        (host, port)
    } else {
        raw.rsplit_once(':').ok_or_else(|| anyhow::anyhow!("missing port"))?
    };
    if host.trim().is_empty() {
        bail!("missing host");
    }
    let port = port.parse::<u16>().context("invalid port")?;
    if port == 0 {
        bail!("port must be positive");
    }
    let host = host.trim().to_owned();
    let loopback = host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().map(is_loopback).unwrap_or(false);
    Ok((host, port, loopback))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    fn valid() -> TunnelMeshConfig {
        TunnelMeshConfig {
            client: TunnelMeshClientConfig {
                server_url: "wss://server.example/ws/client".into(),
                token: "secret-token".into(),
                tunnels: vec![TunnelMeshTunnelConfig {
                    name: "internal".into(),
                    protocol: "socks5".into(),
                    listen_addr: "127.0.0.1:18081".into(),
                    agent_id: "agent-a".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn redacted_snapshot_does_not_contain_token() {
        let snapshot = valid().redacted_snapshot();
        let encoded = serde_json::to_string(&snapshot).unwrap();
        assert!(!encoded.contains("secret-token"));
        assert!(snapshot.client.token_configured);
    }

    #[test]
    fn validation_rejects_duplicate_listener() {
        let mut config = valid();
        config.client.tunnels.push(TunnelMeshTunnelConfig {
            name: "second".into(),
            protocol: "http-proxy".into(),
            listen_addr: "127.0.0.1:18081".into(),
            agent_id: "agent-a".into(),
            ..Default::default()
        });
        let error = config.validate().unwrap_err().to_string();
        assert!(error.contains("duplicate tunnel listen"));
    }

    #[test]
    fn validation_rejects_invalid_server_url_and_public_unauthenticated_listener() {
        let mut config = valid();
        config.client.server_url = "https://server.example/ws/client".into();
        assert!(config.validate().unwrap_err().to_string().contains("ws:// or wss://"));

        let mut config = valid();
        config.client.tunnels[0].listen_addr = "0.0.0.0:18081".into();
        let error = config.validate().unwrap_err().to_string();
        assert!(error.contains("requires allow_remote"));
        assert!(error.contains("requires password auth"));
    }

    #[tokio::test]
    async fn missing_file_loads_without_creating_a_secret_file() {
        let path = std::env::temp_dir().join(format!("tunnelmesh-missing-{}", std::process::id()));
        let _ = tokio::fs::remove_file(&path).await;
        let config = TunnelMeshConfig::load(&path).await.unwrap();
        assert_eq!(config, TunnelMeshConfig::default());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn save_is_atomic_and_owner_only() {
        let root = std::env::temp_dir().join(format!("tunnelmesh-config-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&root).await;
        tokio::fs::create_dir_all(&root).await.unwrap();
        let path = root.join("tunnelmesh.yaml");
        valid().save(&path).await.unwrap();
        let loaded = TunnelMeshConfig::load(&path).await.unwrap();
        assert_eq!(loaded, valid());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}

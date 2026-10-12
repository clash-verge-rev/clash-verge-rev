use crate::tunnelmesh::config::TunnelMeshConfig;
use anyhow::{Result, bail};
use serde_yaml_ng::{Mapping, Value};
use std::collections::HashSet;

/// Adds TunnelMesh local listeners to the generated Mihomo proxy list.
///
/// The transformation is deliberately pure: it never edits proxy groups or
/// rules and never copies TunnelMesh credentials or agent metadata.
pub fn inject_proxies(config: &mut Mapping, tunnelmesh: &TunnelMeshConfig) -> Result<()> {
    let proxies = config
        .entry(Value::String("proxies".into()))
        .or_insert_with(|| Value::Sequence(Vec::new()));
    let Value::Sequence(proxies) = proxies else {
        bail!("Mihomo proxies must be a sequence");
    };

    let mut names = HashSet::new();
    for proxy in proxies.iter() {
        if let Some(name) = proxy
            .as_mapping()
            .and_then(|map| map.get("name"))
            .and_then(Value::as_str)
        {
            names.insert(name.to_owned());
        } else if let Some(name) = proxy.as_str() {
            names.insert(name.to_owned());
        }
    }

    let mut generated = Vec::new();
    for tunnel in &tunnelmesh.client.tunnels {
        let protocol = tunnel.protocol.trim().to_ascii_lowercase();
        if !matches!(protocol.as_str(), "socks5" | "http-proxy") {
            continue;
        }
        let name = format!("TunnelMesh/{}", tunnel.name.trim());
        if !names.insert(name.clone()) {
            bail!("TunnelMesh proxy name collides with an existing proxy: {name}");
        }
        let address: std::net::SocketAddr = tunnel
            .listen_addr
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("invalid TunnelMesh listener for {name}"))?;
        let mut proxy = Mapping::new();
        proxy.insert("name".into(), name.into());
        proxy.insert(
            "type".into(),
            if protocol == "socks5" { "socks5" } else { "http" }.into(),
        );
        proxy.insert("server".into(), address.ip().to_string().into());
        proxy.insert("port".into(), i64::from(address.port()).into());
        generated.push(Value::Mapping(proxy));
    }
    proxies.extend(generated);
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::tunnelmesh::config::{TunnelMeshClientConfig, TunnelMeshTunnelConfig};

    fn config() -> Mapping {
        serde_yaml_ng::from_str("proxies:\n  - name: existing\n    type: direct\n").unwrap()
    }

    fn tunnel(name: &str, protocol: &str, listen: &str) -> TunnelMeshTunnelConfig {
        TunnelMeshTunnelConfig {
            name: name.into(),
            protocol: protocol.into(),
            listen_addr: listen.into(),
            agent_id: "agent".into(),
            ..Default::default()
        }
    }

    #[test]
    fn injects_socks_and_http_without_groups_or_secrets() {
        let mut yaml = config();
        let tm = TunnelMeshConfig {
            client: TunnelMeshClientConfig {
                token: "secret".into(),
                tunnels: vec![
                    tunnel("s", "socks5", "127.0.0.1:18081"),
                    tunnel("h", "http-proxy", "[::1]:18082"),
                ],
                ..Default::default()
            },
            ..Default::default()
        };
        inject_proxies(&mut yaml, &tm).unwrap();
        let encoded = serde_yaml_ng::to_string(&yaml).unwrap();
        assert!(encoded.contains("TunnelMesh/s"));
        assert!(encoded.contains("type: http"));
        assert!(!encoded.contains("secret"));
        assert!(yaml.get("proxy-groups").is_none());
    }

    #[test]
    fn skips_raw_tunnels_and_rejects_name_collisions() {
        let mut yaml = config();
        yaml["proxies"].as_sequence_mut().unwrap()[0]["name"] = "TunnelMesh/existing".into();
        let tm = TunnelMeshConfig {
            client: TunnelMeshClientConfig {
                tunnels: vec![
                    tunnel("raw", "tcp", "127.0.0.1:1"),
                    tunnel("existing", "socks5", "127.0.0.1:2"),
                ],
                ..Default::default()
            },
            ..Default::default()
        };
        let error = inject_proxies(&mut yaml, &tm).unwrap_err().to_string();
        assert!(error.contains("collides"));
        assert_eq!(yaml["proxies"].as_sequence().unwrap().len(), 1);
    }
}

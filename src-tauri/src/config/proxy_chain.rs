use anyhow::{Context as _, Result, ensure};
use serde_yaml_ng::{Mapping, Value};
use std::collections::HashSet;

/// Apply saved manual intent to fresh profile output, never to the previous runtime.
pub(crate) fn apply_proxy_chain(config: &mut Mapping, chain: &[String]) -> Result<()> {
    ensure!(chain.len() >= 2, "a proxy chain requires at least two nodes");
    let mut names = HashSet::new();
    let proxies = config
        .get_mut("proxies")
        .and_then(Value::as_sequence_mut)
        .context("proxy chain requires inline proxies")?;
    let mut indices = Vec::with_capacity(chain.len());
    for name in chain {
        ensure!(names.insert(name), "duplicate node in proxy chain: {name}");
        let index = proxies
            .iter()
            .position(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name.as_str()))
            .with_context(|| format!("proxy chain node is missing from the profile: {name}"))?;
        ensure!(proxies[index].is_mapping(), "invalid proxy chain node: {name}");
        indices.push(index);
    }

    // Validate the complete chain before editing; a missing hop must not become a direct route.
    for (hop, index) in indices.into_iter().enumerate() {
        let proxy = proxies[index].as_mapping_mut().context("invalid proxy chain node")?;
        if hop == 0 {
            proxy.remove("dialer-proxy");
        } else {
            proxy.insert("dialer-proxy".into(), chain[hop - 1].clone().into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::apply_proxy_chain;
    use anyhow::Result;
    use serde_yaml_ng::{Mapping, Value};

    fn profile(port: u16) -> Result<Mapping> {
        Ok(serde_yaml_ng::from_str(&format!(
            "proxies:\n  - {{name: entry, port: {port}}}\n  - {{name: middle}}\n  - {{name: exit}}\n  - {{name: scripted, dialer-proxy: entry}}\n"
        ))?)
    }

    fn chain() -> Vec<String> {
        vec!["entry".into(), "middle".into(), "exit".into()]
    }

    #[test]
    fn regenerated_profiles_reapply_saved_chain_with_fresh_node_settings() -> Result<()> {
        let saved = serde_yaml_ng::to_string(&chain())?;
        for port in [1000, 2000, 3000] {
            let restored: Vec<String> = serde_yaml_ng::from_str(&saved)?;
            let mut config = profile(port)?;
            apply_proxy_chain(&mut config, &restored)?;
            let nodes = &config["proxies"];
            assert_eq!(nodes[0]["port"], Value::from(port));
            assert!(nodes[0].get("dialer-proxy").is_none());
            assert_eq!(nodes[1]["dialer-proxy"], Value::from("entry"));
            assert_eq!(nodes[2]["dialer-proxy"], Value::from("middle"));
            assert_eq!(nodes[3]["dialer-proxy"], Value::from("entry"));
        }
        Ok(())
    }

    #[test]
    fn switching_chains_uses_fresh_profile_links() -> Result<()> {
        let mut first = profile(1000)?;
        apply_proxy_chain(&mut first, &chain())?;
        let mut next = profile(2000)?;
        apply_proxy_chain(&mut next, &["middle".into(), "exit".into()])?;
        assert!(next["proxies"][1].get("dialer-proxy").is_none());
        assert_eq!(next["proxies"][2]["dialer-proxy"], Value::from("middle"));
        assert_eq!(next["proxies"][3]["dialer-proxy"], Value::from("entry"));
        Ok(())
    }

    #[test]
    fn a_missing_or_repeated_hop_rejects_the_whole_chain() -> Result<()> {
        for chain in [
            vec!["entry".into(), "missing".into(), "exit".into()],
            vec!["entry".into(), "entry".into()],
        ] {
            let mut config = profile(1000)?;
            let original = config.clone();
            assert!(apply_proxy_chain(&mut config, &chain).is_err());
            assert_eq!(config, original);
        }
        Ok(())
    }
}

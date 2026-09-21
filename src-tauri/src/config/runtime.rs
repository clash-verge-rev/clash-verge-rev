use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::collections::{HashMap, HashSet};

use crate::enhance::field::use_keys;

const PATCH_CONFIG_INNER: [&str; 5] = ["allow-lan", "ipv6", "log-level", "unified-delay", "tunnels"];

#[derive(Default, Clone)]
pub struct IRuntime {
    pub config: Option<Mapping>,
    pub(crate) profile_uid: Option<String>,
    // Session-only user intent, separate from the configuration rebuilt by profile updates.
    pub(crate) active_proxy_chain: Option<Value>,
    // Keys seen in the profile pipeline, including merge and script output.
    pub exists_keys: HashSet<String>,
    // TODO 或许可以用 FixMap 来存储以提升效率
    pub chain_logs: HashMap<String, Vec<(String, String)>>,
}

impl IRuntime {
    /// Restores the user chain before a regenerated config is validated and loaded.
    pub(crate) fn inherit_proxy_chain(&mut self, previous: &Self) -> anyhow::Result<()> {
        if self.profile_uid != previous.profile_uid {
            return Ok(());
        }
        let Some(chain) = previous.active_proxy_chain.as_ref() else {
            // Do not touch dialer-proxy links supplied by the profile itself.
            return Ok(());
        };
        if let Some(names) = chain.as_sequence() {
            let proxies = self.config.as_ref().and_then(|config| config.get("proxies"));
            for name in names {
                anyhow::ensure!(
                    proxies
                        .and_then(Value::as_sequence)
                        .is_some_and(|proxies| { proxies.iter().any(|proxy| proxy.get("name") == Some(name)) }),
                    "Cannot preserve active proxy chain: node {:?} is missing from the refreshed profile",
                    name.as_str()
                );
            }
        }
        self.update_proxy_chain_config(Some(chain.clone()));
        Ok(())
    }

    #[inline]
    pub fn patch_config(&mut self, patch: &Mapping) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        for key in PATCH_CONFIG_INNER.iter() {
            if let Some(value) = patch.get(key) {
                config.insert((*key).into(), value.clone());
            }
        }

        let Some(patch_tun) = patch.get("tun") else {
            return;
        };

        let tun_key = Value::from("tun");
        if !matches!(config.get(&tun_key), Some(Value::Mapping(_))) {
            config.insert(tun_key.clone(), Value::Mapping(Mapping::new()));
        }

        if let (Some(patch_tun_mapping), Some(Value::Mapping(tun))) = (patch_tun.as_mapping(), config.get_mut(&tun_key))
        {
            for key in use_keys(patch_tun_mapping) {
                if let Some(value) = patch_tun_mapping.get(key.as_str()) {
                    tun.insert(Value::from(key.as_str()), value.clone());
                }
            }
        }
    }

    /// Rebuilds `dialer-proxy` links from an ordered proxy chain, or removes them for `None`.
    #[inline]
    pub fn update_proxy_chain_config(&mut self, proxy_chain_config: Option<Value>) {
        let config = if let Some(config) = self.config.as_mut() {
            config
        } else {
            return;
        };

        self.active_proxy_chain = proxy_chain_config
            .clone()
            .filter(|value| value.as_sequence().is_some_and(|nodes| nodes.len() >= 2));

        if let Some(Value::Sequence(proxies)) = config.get_mut("proxies") {
            proxies.iter_mut().for_each(|proxy| {
                if let Some(proxy) = proxy.as_mapping_mut()
                    && proxy.get("dialer-proxy").is_some()
                {
                    proxy.remove("dialer-proxy");
                }
            });
        }

        if let Some(Value::Sequence(dialer_proxies)) = proxy_chain_config
            && let Some(Value::Sequence(proxies)) = config.get_mut("proxies")
        {
            for (i, dialer_proxy) in dialer_proxies.iter().enumerate() {
                if let Some(Value::Mapping(proxy)) =
                    proxies.iter_mut().find(|proxy| proxy.get("name") == Some(dialer_proxy))
                    && i != 0
                    && let Some(dialer_proxy) = dialer_proxies.get(i - 1)
                {
                    proxy.insert("dialer-proxy".into(), dialer_proxy.to_owned());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IRuntime;
    use anyhow::{Context as _, Result};
    use clash_verge_draft::Draft;
    use serde_yaml_ng::Value;

    fn runtime(profile: &str, port: u16) -> Result<IRuntime> {
        Ok(IRuntime {
            config: Some(serde_yaml_ng::from_str(&format!(
                "proxies:\n  - {{name: entry, port: {port}}}\n  - {{name: middle}}\n  - {{name: exit}}\n"
            ))?),
            profile_uid: Some(profile.into()),
            ..IRuntime::default()
        })
    }

    fn chain() -> Value {
        Value::Sequence(vec!["entry".into(), "middle".into(), "exit".into()])
    }

    fn proxies(runtime: &IRuntime) -> Result<&Vec<Value>> {
        runtime
            .config
            .as_ref()
            .and_then(|config| config.get("proxies"))
            .and_then(Value::as_sequence)
            .context("test config must contain proxies")
    }

    #[test]
    fn refresh_preserves_chain_and_uses_new_node_configuration() -> Result<()> {
        let mut current = runtime("a", 1000)?;
        current.update_proxy_chain_config(Some(chain()));

        for port in 1001..1004 {
            let mut refreshed = runtime("a", port)?;
            refreshed.inherit_proxy_chain(&current)?;
            let nodes = proxies(&refreshed)?;
            assert_eq!(nodes[0]["port"], Value::from(port));
            assert!(nodes[0].get("dialer-proxy").is_none());
            assert_eq!(nodes[1]["dialer-proxy"], Value::from("entry"));
            assert_eq!(nodes[2]["dialer-proxy"], Value::from("middle"));
            assert_eq!(refreshed.active_proxy_chain, Some(chain()));
            current = refreshed;
        }
        Ok(())
    }

    #[test]
    fn refresh_without_user_chain_preserves_profile_dialers() -> Result<()> {
        let current = runtime("a", 1000)?;
        let mut refreshed = runtime("a", 2000)?;
        refreshed.config = Some(serde_yaml_ng::from_str(
            "proxies:\n  - {name: entry}\n  - {name: exit, dialer-proxy: entry}\n",
        )?);
        let expected = refreshed.config.clone();
        refreshed.inherit_proxy_chain(&current)?;
        assert_eq!(refreshed.config, expected);
        assert!(refreshed.active_proxy_chain.is_none());
        Ok(())
    }

    #[test]
    fn manual_disconnect_is_not_restored_on_refresh() -> Result<()> {
        let mut current = runtime("a", 1000)?;
        current.update_proxy_chain_config(Some(chain()));
        current.update_proxy_chain_config(None);
        assert!(current.active_proxy_chain.is_none());
        assert!(proxies(&current)?.iter().all(|node| node.get("dialer-proxy").is_none()));

        let mut refreshed = runtime("a", 2000)?;
        refreshed.inherit_proxy_chain(&current)?;
        assert!(refreshed.active_proxy_chain.is_none());
        assert!(
            proxies(&refreshed)?
                .iter()
                .all(|node| node.get("dialer-proxy").is_none())
        );
        Ok(())
    }

    #[test]
    fn switching_profiles_does_not_inherit_the_previous_chain() -> Result<()> {
        let mut current = runtime("a", 1000)?;
        current.update_proxy_chain_config(Some(chain()));
        let mut other = runtime("b", 2000)?;
        let expected = other.config.clone();
        other.inherit_proxy_chain(&current)?;
        assert_eq!(other.config, expected);
        assert!(other.active_proxy_chain.is_none());
        Ok(())
    }

    #[test]
    fn missing_chain_node_rejects_refresh_without_partial_links() -> Result<()> {
        let mut current = runtime("a", 1000)?;
        current.update_proxy_chain_config(Some(chain()));
        let mut refreshed = runtime("a", 2000)?;
        refreshed.config = Some(serde_yaml_ng::from_str(
            "proxies:\n  - {name: entry}\n  - {name: exit}\n",
        )?);
        let expected = refreshed.config.clone();
        let error = refreshed
            .inherit_proxy_chain(&current)
            .err()
            .context("missing middle node must reject refresh")?;
        assert!(error.to_string().contains("middle"));
        assert_eq!(refreshed.config, expected);
        assert!(refreshed.active_proxy_chain.is_none());
        Ok(())
    }

    #[test]
    fn failed_runtime_update_rolls_back_chain_intent() -> Result<()> {
        let mut current = runtime("a", 1000)?;
        current.update_proxy_chain_config(Some(chain()));
        let draft = Draft::new(current);
        draft.edit_draft(|runtime| runtime.update_proxy_chain_config(None));
        draft.discard();
        let mut refreshed = runtime("a", 2000)?;
        refreshed.inherit_proxy_chain(&draft.latest_arc())?;
        assert_eq!(refreshed.active_proxy_chain, Some(chain()));
        assert_eq!(proxies(&refreshed)?[2]["dialer-proxy"], Value::from("middle"));
        Ok(())
    }
}

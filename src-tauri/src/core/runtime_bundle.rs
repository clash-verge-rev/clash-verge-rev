use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use clash_verge_service_ipc::{RemoteProvider, RuntimeAsset, RuntimeBundle};
use serde_yaml_ng::Value;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

const GEO_ASSETS: &[&str] = &[
    "Country.mmdb",
    "geoip.dat",
    "geosite.dat",
    "geoip.metadb",
    "GeoSite.dat",
];

pub(crate) async fn collect_runtime_bundle(config_file: &Path, core_path: &Path) -> Result<RuntimeBundle> {
    let yaml = tokio::fs::read_to_string(config_file)
        .await
        .with_context(|| format!("failed to read runtime config {config_file:?}"))?;
    let mut config: Value =
        serde_yaml_ng::from_str(&yaml).with_context(|| format!("failed to parse runtime config {config_file:?}"))?;
    let config_root = config_file
        .parent()
        .ok_or_else(|| anyhow::anyhow!("runtime config has no parent directory"))?;
    let config_root = std::fs::canonicalize(config_root)?;
    let mut assets = Vec::new();
    let mut destinations = HashSet::new();
    let mut remote_providers = Vec::new();

    collect_provider_assets(
        &mut config,
        "proxy-providers",
        &config_root,
        &mut destinations,
        &mut assets,
        &mut remote_providers,
    )?;
    collect_provider_assets(
        &mut config,
        "rule-providers",
        &config_root,
        &mut destinations,
        &mut assets,
        &mut remote_providers,
    )?;
    for filename in GEO_ASSETS {
        let source = config_root.join(filename);
        if source.is_file() && destinations.insert((*filename).to_string()) {
            assets.push(RuntimeAsset {
                source: std::fs::canonicalize(&source)?.to_string_lossy().into_owned(),
                destination: (*filename).to_string(),
            });
        }
    }

    Ok(RuntimeBundle {
        yaml: serde_yaml_ng::to_string(&config).context("failed to serialize service runtime config")?,
        assets,
        remote_providers,
        core_path: core_path.to_string_lossy().into_owned(),
    })
}

/// Rewrites provider paths and records copied assets separately from core-downloaded providers.
/// Remote URLs let the service decide whether a core download cache remains reusable.
fn collect_provider_assets(
    config: &mut Value,
    section: &str,
    config_root: &Path,
    destinations: &mut HashSet<String>,
    assets: &mut Vec<RuntimeAsset>,
    remote_providers: &mut Vec<RemoteProvider>,
) -> Result<()> {
    let Some(providers) = config
        .as_mapping_mut()
        .and_then(|mapping| mapping.get_mut(section))
        .and_then(Value::as_mapping_mut)
    else {
        return Ok(());
    };

    for (name, provider) in providers.iter_mut() {
        let Some(provider) = provider.as_mapping_mut() else {
            continue;
        };
        let Some(raw_path) = provider.get("path").and_then(Value::as_str) else {
            continue;
        };
        // Match mihomo's `type` classification and leave malformed-but-accepted providers untouched.
        let is_remote = provider.get("type").and_then(Value::as_str) == Some("http");
        let url = provider.get("url").and_then(Value::as_str).map(str::to_owned);
        let destination = match (is_remote, url) {
            (true, Some(url)) => {
                let destination = provider_destination(config_root, raw_path)?;
                // Reserve remote destinations too; copied and downloaded files must not collide.
                match remote_providers
                    .iter()
                    .find(|declared| declared.destination == destination)
                {
                    Some(declared) if declared.url == url => {}
                    Some(_) => {
                        bail!("runtime provider destination {destination:?} is declared for two different sources")
                    }
                    None => {
                        if !destinations.insert(destination.clone()) {
                            bail!("runtime provider destination {destination:?} is claimed more than once");
                        }
                        remote_providers.push(RemoteProvider {
                            destination: destination.clone(),
                            url,
                        });
                    }
                }
                destination
            }
            (true, None) => {
                logging!(
                    warn,
                    Type::Config,
                    "remote provider {name:?} declares no url; leaving its path to the core"
                );
                continue;
            }
            (false, _) => {
                let Ok(source) = local_provider_source(config_root, raw_path) else {
                    logging!(
                        warn,
                        Type::Config,
                        "local provider {name:?} is unavailable at {raw_path:?}; leaving its path to the core"
                    );
                    continue;
                };
                let destination = destination_below_root(config_root, &source)?;
                if destinations.insert(destination.clone()) {
                    assets.push(RuntimeAsset {
                        source: source.to_string_lossy().into_owned(),
                        destination: destination.clone(),
                    });
                }
                destination
            }
        };
        provider.insert(Value::String("path".to_owned()), Value::String(destination));
    }
    Ok(())
}

fn local_provider_source(config_root: &Path, raw_path: &str) -> Result<PathBuf> {
    let path = Path::new(raw_path);
    let source = if path.is_absolute() {
        path.to_path_buf()
    } else {
        config_root.join(path)
    };
    let canonical_source =
        std::fs::canonicalize(&source).with_context(|| format!("local runtime provider is unavailable: {source:?}"))?;
    canonical_source
        .strip_prefix(config_root)
        .map_err(|_| anyhow::anyhow!("local runtime provider is outside the config root: {canonical_source:?}"))?;
    Ok(canonical_source)
}

fn provider_destination(config_root: &Path, raw_path: &str) -> Result<String> {
    let path = Path::new(raw_path);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        bail!("runtime provider destination traverses outside the runtime");
    }
    if path.is_absolute() {
        let normalized = canonicalize_with_missing_tail(path)?;
        destination_below_root(config_root, &normalized)
    } else {
        normalized_destination(path)
    }
}

fn canonicalize_with_missing_tail(path: &Path) -> Result<PathBuf> {
    let mut ancestor = path;
    let mut tail = Vec::new();
    while !ancestor.exists() {
        let name = ancestor
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("runtime provider path has no existing ancestor: {path:?}"))?;
        tail.push(name.to_owned());
        ancestor = ancestor
            .parent()
            .ok_or_else(|| anyhow::anyhow!("runtime provider path has no existing ancestor: {path:?}"))?;
    }
    let mut normalized = std::fs::canonicalize(ancestor)?;
    for component in tail.iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

fn destination_below_root(config_root: &Path, path: &Path) -> Result<String> {
    let relative = path
        .strip_prefix(config_root)
        .map_err(|_| anyhow::anyhow!("runtime provider path is outside the config root: {path:?}"))?;
    normalized_destination(relative)
}

fn normalized_destination(relative: &Path) -> Result<String> {
    let mut destination = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(component) => destination.push(component),
            Component::CurDir => {}
            _ => bail!("local runtime provider destination traverses outside the runtime"),
        }
    }
    if destination.as_os_str().is_empty() {
        bail!("local runtime provider destination is empty");
    }
    Ok(destination.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::collect_runtime_bundle;

    #[tokio::test]
    async fn collects_only_local_providers_and_existing_geo_assets() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("clash-verge-runtime-bundle-{}", std::process::id()));
        std::fs::create_dir_all(root.join("providers"))?;
        std::fs::write(root.join("providers/local.yaml"), b"proxies: []\n")?;
        std::fs::write(root.join("Country.mmdb"), b"geo")?;
        let config = root.join("config.yaml");
        let absolute_local = root.join("providers/local.yaml");
        let absolute_remote = root.join("providers/remote.yaml");
        std::fs::write(
            &config,
            format!(
                "proxy-providers:\n  local:\n    type: file\n    path: {}\n  remote:\n    type: http\n    url: https://example.com/p.yaml\n    path: {}\nrule-providers: {{}}\n",
                absolute_local.display(),
                absolute_remote.display()
            ),
        )?;
        let core = root.join("mihomo");
        std::fs::write(&core, b"core")?;

        let bundle = collect_runtime_bundle(&config, &core).await?;

        let bundled_config: serde_yaml_ng::Value = serde_yaml_ng::from_str(&bundle.yaml)?;
        assert_eq!(
            bundled_config["proxy-providers"]["local"]["path"].as_str(),
            Some("providers/local.yaml")
        );
        assert_eq!(
            bundled_config["proxy-providers"]["remote"]["path"].as_str(),
            Some("providers/remote.yaml")
        );
        assert!(!bundle.yaml.contains(&root.to_string_lossy().into_owned()));
        assert!(
            bundle
                .assets
                .iter()
                .any(|asset| asset.destination == "providers/local.yaml")
        );
        assert!(bundle.assets.iter().any(|asset| asset.destination == "Country.mmdb"));
        assert!(!bundle.assets.iter().any(|asset| asset.destination.contains("remote")));
        // Remote declarations preserve service-side cache reuse.
        assert_eq!(
            bundle
                .remote_providers
                .iter()
                .map(|provider| (provider.destination.as_str(), provider.url.as_str()))
                .collect::<Vec<_>>(),
            [("providers/remote.yaml", "https://example.com/p.yaml")],
            "the declaration must pair the rewritten destination with the url, not the original path"
        );
        assert!(
            !bundle
                .assets
                .iter()
                .any(|asset| asset.destination.contains("geoip.dat"))
        );
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[tokio::test]
    async fn two_names_for_one_remote_file_are_folded_rather_than_refused() -> anyhow::Result<()> {
        // Identical repeats are one service-side file and are safe to fold.
        let root = std::env::temp_dir().join(format!("clash-verge-bundle-dup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root)?;
        let config = root.join("config.yaml");
        std::fs::write(
            &config,
            "rule-providers:\n  a:\n    type: http\n    url: https://one.example/x.yaml\n    path: ./rules/x.yaml\n  b:\n    type: http\n    url: https://one.example/x.yaml\n    path: ./rules/x.yaml\n",
        )?;
        let core = root.join("mihomo");
        std::fs::write(&core, b"core")?;

        let bundle = collect_runtime_bundle(&config, &core).await?;

        assert_eq!(bundle.remote_providers.len(), 1, "one file, declared twice");
        assert_eq!(bundle.remote_providers[0].destination, "rules/x.yaml");
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[tokio::test]
    async fn two_sources_for_one_remote_file_are_refused() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("clash-verge-bundle-conflict-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root)?;
        let config = root.join("config.yaml");
        std::fs::write(
            &config,
            "rule-providers:\n  a:\n    type: http\n    url: https://one.example/x.yaml\n    path: ./rules/x.yaml\n  b:\n    type: http\n    url: https://two.example/x.yaml\n    path: ./rules/x.yaml\n",
        )?;
        let core = root.join("mihomo");
        std::fs::write(&core, b"core")?;

        let Err(error) = collect_runtime_bundle(&config, &core).await else {
            anyhow::bail!("two sources cannot own one file");
        };

        assert!(error.to_string().contains("two different sources"), "{error}");
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[tokio::test]
    async fn an_odd_provider_is_left_alone_instead_of_failing_the_whole_bundle() -> anyhow::Result<()> {
        // Odd providers accepted by mihomo must not block the rest of the bundle.
        let root = std::env::temp_dir().join(format!("clash-verge-bundle-odd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root)?;
        let config = root.join("config.yaml");
        std::fs::write(
            &config,
            "rule-providers:\n  nourl:\n    type: http\n    path: ./rules/nourl.yaml\n  missing:\n    type: inline\n    url: https://one.example/i.yaml\n    path: ./rules/missing.yaml\n  good:\n    type: http\n    url: https://one.example/g.yaml\n    path: ./rules/g.yaml\n",
        )?;
        let core = root.join("mihomo");
        std::fs::write(&core, b"core")?;

        let bundle = collect_runtime_bundle(&config, &core).await?;

        assert_eq!(
            bundle.remote_providers.len(),
            1,
            "only the provider that could be classified is declared"
        );
        assert_eq!(bundle.remote_providers[0].destination, "rules/g.yaml");
        let reserialized: serde_yaml_ng::Value = serde_yaml_ng::from_str(&bundle.yaml)?;
        assert_eq!(
            reserialized["rule-providers"]["nourl"]["path"].as_str(),
            Some("./rules/nourl.yaml"),
            "an unclassifiable provider keeps the path the core was given"
        );
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[tokio::test]
    async fn rejects_provider_paths_outside_the_config_root() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("clash-verge-runtime-bundle-outside-{}", std::process::id()));
        std::fs::create_dir_all(&root)?;
        let config = root.join("config.yaml");
        let outside = root
            .parent()
            .ok_or_else(|| anyhow::anyhow!("test root has no parent"))?
            .join(format!("outside-{}.yaml", std::process::id()));
        std::fs::write(
            &config,
            format!(
                "proxy-providers:\n  remote:\n    type: http\n    url: https://example.com/p.yaml\n    path: {}\n",
                outside.display()
            ),
        )?;
        let core = root.join("mihomo");
        std::fs::write(&core, b"core")?;

        let Err(error) = collect_runtime_bundle(&config, &core).await else {
            anyhow::bail!("outside provider path must be rejected");
        };

        assert!(error.to_string().contains("outside the config root"));
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}

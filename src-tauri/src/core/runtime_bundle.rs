use anyhow::{Context as _, Result, bail};
use clash_verge_service_ipc::{RuntimeAsset, RuntimeBundle};
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

    collect_provider_assets(
        &mut config,
        "proxy-providers",
        &config_root,
        &mut destinations,
        &mut assets,
    )?;
    collect_provider_assets(
        &mut config,
        "rule-providers",
        &config_root,
        &mut destinations,
        &mut assets,
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
        core_path: core_path.to_string_lossy().into_owned(),
    })
}

fn collect_provider_assets(
    config: &mut Value,
    section: &str,
    config_root: &Path,
    destinations: &mut HashSet<String>,
    assets: &mut Vec<RuntimeAsset>,
) -> Result<()> {
    let Some(providers) = config
        .as_mapping_mut()
        .and_then(|mapping| mapping.get_mut(section))
        .and_then(Value::as_mapping_mut)
    else {
        return Ok(());
    };

    for provider in providers.values_mut().filter_map(Value::as_mapping_mut) {
        let Some(raw_path) = provider.get("path").and_then(Value::as_str) else {
            continue;
        };
        let is_remote = provider.get("url").and_then(Value::as_str).is_some();
        let destination = if is_remote {
            provider_destination(config_root, raw_path)?
        } else {
            let source = local_provider_source(config_root, raw_path)?;
            let destination = destination_below_root(config_root, &source)?;
            if destinations.insert(destination.clone()) {
                assets.push(RuntimeAsset {
                    source: source.to_string_lossy().into_owned(),
                    destination: destination.clone(),
                });
            }
            destination
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

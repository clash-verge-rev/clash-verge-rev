use super::{Config, IProfiles, PrfItem, PrfOption, profiles::PROFILE_WRITE_LOCK};
use crate::{
    enhance::seq::SeqMap,
    utils::{dirs, help},
};
use anyhow::{Context as _, Result, ensure};
use clash_verge_draft::Draft;
use clash_verge_logging::{Type, logging};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{File, OpenOptions},
    io::{Read as _, Write as _},
    path::{Component, Path, PathBuf},
};
use tristr::alias::String;

const FORMAT: &str = "clash-verge-profile";
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_UPDATE_INTERVAL: u64 = 365 * 24 * 60;
const EXTENSIONS: [&str; 5] = ["merge", "script", "rules", "proxies", "groups"];

#[derive(Clone, Serialize, Deserialize)]
struct Manifest {
    format: std::string::String,
    version: u32,
    profile: PrfItem,
    extensions: Vec<std::string::String>,
}

struct Bundle {
    manifest: Manifest,
    files: BTreeMap<std::string::String, std::string::String>,
}

fn entry_name(kind: &str) -> std::string::String {
    format!("{kind}.{}", if kind == "script" { "js" } else { "yaml" })
}

fn binding<'a>(option: &'a PrfOption, kind: &str) -> Option<&'a String> {
    match kind {
        "merge" => option.merge.as_ref(),
        "script" => option.script.as_ref(),
        "rules" => option.rules.as_ref(),
        "proxies" => option.proxies.as_ref(),
        "groups" => option.groups.as_ref(),
        _ => None,
    }
}

fn set_binding(option: &mut PrfOption, kind: &str, uid: Option<String>) {
    match kind {
        "merge" => option.merge = uid,
        "script" => option.script = uid,
        "rules" => option.rules = uid,
        "proxies" => option.proxies = uid,
        "groups" => option.groups = uid,
        _ => unreachable!(),
    }
}

fn portable_profile(item: &PrfItem) -> PrfItem {
    let mut option = item.option.clone().unwrap_or_default();
    for kind in EXTENSIONS {
        set_binding(&mut option, kind, None);
    }
    PrfItem {
        itype: item.itype.clone(),
        name: item.name.clone(),
        desc: item.desc.clone(),
        url: (item.itype.as_deref() == Some("remote"))
            .then(|| item.url.clone())
            .flatten(),
        home: item
            .home
            .as_deref()
            .and_then(super::prfitem::normalize_profile_home_url),
        option: Some(option),
        ..Default::default()
    }
}

impl Bundle {
    fn capture(profiles: &IProfiles, index: &str, directory: &Path) -> Result<Self> {
        let profile = profiles.get_item(index)?;
        let mut bundle = Self {
            manifest: Manifest {
                format: FORMAT.to_owned(),
                version: 1,
                profile: portable_profile(profile),
                extensions: Vec::new(),
            },
            files: BTreeMap::new(),
        };
        let mut bytes = 0;
        let mut read_item = |item: &PrfItem| -> Result<std::string::String> {
            let name = item.file.as_deref().context("Profile file is missing")?;
            let mut components = Path::new(name).components();
            ensure!(
                !name.contains(['/', '\\'])
                    && matches!(
                        (components.next(), components.next()),
                        (Some(Component::Normal(_)), None)
                    ),
                "Profile file must be a single filename"
            );
            let mut text = std::string::String::new();
            File::open(directory.join(name))?
                .take(MAX_BYTES - bytes + 1)
                .read_to_string(&mut text)?;
            bytes += text.len() as u64;
            ensure!(bytes <= MAX_BYTES, "Subscription bundle exceeds 64 MiB");
            Ok(text)
        };
        bundle.files.insert("profile.yaml".into(), read_item(profile)?);
        if let Some(option) = &profile.option {
            for kind in EXTENSIONS {
                if let Some(uid) = binding(option, kind) {
                    let item = profiles.get_item(uid)?;
                    ensure!(item.itype.as_deref() == Some(kind), "Invalid {kind} extension type");
                    bundle.files.insert(entry_name(kind), read_item(item)?);
                    bundle.manifest.extensions.push(kind.to_owned());
                }
            }
        }
        bundle.validate()?;
        Ok(bundle)
    }

    fn validate(&self) -> Result<()> {
        ensure!(
            self.manifest.format == FORMAT && self.manifest.version == 1,
            "Unsupported subscription bundle format or version"
        );
        let profile = &self.manifest.profile;
        ensure!(
            matches!(profile.itype.as_deref(), Some("remote" | "local")),
            "Bundle must contain a local or remote subscription"
        );
        if profile.itype.as_deref() == Some("remote") {
            let url = tauri::Url::parse(profile.url.as_deref().context("Subscription URL is missing")?)?;
            ensure!(
                matches!(url.scheme(), "http" | "https") && url.host_str().is_some(),
                "Subscription URL must use HTTP or HTTPS"
            );
        }
        ensure!(
            profile
                .option
                .as_ref()
                .and_then(|option| option.update_interval)
                .unwrap_or(0)
                <= MAX_UPDATE_INTERVAL,
            "Subscription update interval cannot exceed one year"
        );
        let kinds: HashSet<_> = self
            .manifest
            .extensions
            .iter()
            .map(std::string::String::as_str)
            .collect();
        ensure!(
            kinds.len() == self.manifest.extensions.len() && kinds.iter().all(|kind| EXTENSIONS.contains(kind)),
            "Invalid or duplicate extension kind"
        );
        ensure!(
            self.files.len() == kinds.len() + 1 && self.files.contains_key("profile.yaml"),
            "Subscription bundle entries do not match the manifest"
        );
        serde_yaml_ng::from_str::<serde_yaml_ng::Mapping>(&self.files["profile.yaml"])
            .context("Invalid subscription YAML")?;
        for kind in kinds {
            let text = self
                .files
                .get(&entry_name(kind))
                .with_context(|| format!("Missing {kind} extension"))?;
            match kind {
                "script" => {}
                "merge" => {
                    let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(text)?;
                    ensure!(
                        value.is_null() || value.is_mapping(),
                        "Merge extension must be a YAML mapping"
                    );
                }
                _ => {
                    serde_yaml_ng::from_str::<SeqMap>(text).with_context(|| format!("Invalid {kind} extension"))?;
                }
            }
        }
        let bytes = serde_json::to_vec(&self.manifest)?.len() as u64
            + self.files.values().map(|text| text.len() as u64).sum::<u64>();
        ensure!(bytes <= MAX_BYTES, "Subscription bundle exceeds 64 MiB");
        Ok(())
    }

    fn into_items(self, profiles: &IProfiles) -> Result<Vec<PrfItem>> {
        self.validate()?;
        let mut profile = portable_profile(&self.manifest.profile);
        let mut files = self.files;
        let mut items = Vec::new();
        for kind in &self.manifest.extensions {
            let item = new_item(kind, files.remove(&entry_name(kind)).context("Missing extension")?);
            set_binding(
                profile.option.as_mut().context("Missing subscription options")?,
                kind,
                item.uid.clone(),
            );
            items.push(item);
        }
        let item = new_item(
            profile.itype.as_deref().context("Missing subscription type")?,
            files.remove("profile.yaml").context("Missing subscription")?,
        );
        profile.uid = item.uid;
        profile.file = item.file;
        profile.updated = item.updated;
        profile.file_data = item.file_data;
        items.push(profile);
        let mut uids: HashSet<_> = profiles
            .items
            .iter()
            .flatten()
            .filter_map(|item| item.uid.as_deref())
            .collect();
        for item in &items {
            ensure!(
                uids.insert(item.uid.as_deref().context("Missing generated UID")?),
                "Generated subscription UID already exists"
            );
        }
        Ok(items)
    }
}

fn new_item(kind: &str, content: std::string::String) -> PrfItem {
    let uid = help::get_uid(if kind == "remote" {
        "R"
    } else if kind == "local" {
        "L"
    } else {
        kind
    });
    PrfItem {
        file: Some(format!("{uid}.{}", if kind == "script" { "js" } else { "yaml" }).into()),
        uid: Some(uid.into()),
        itype: Some(kind.into()),
        updated: Some(chrono::Utc::now().timestamp() as usize),
        file_data: Some(content.into()),
        ..Default::default()
    }
}

fn read_bundle(source: &Path) -> Result<Bundle> {
    let file = File::open(source)?;
    ensure!(
        file.metadata()?.len() <= MAX_BYTES,
        "Subscription bundle exceeds 64 MiB"
    );
    let mut archive = zip::ZipArchive::new(file)?;
    ensure!(!archive.has_duplicate_names(), "Duplicate subscription bundle entry");
    ensure!(
        (2..=7).contains(&archive.len()),
        "Invalid subscription bundle entry count"
    );
    let mut files = BTreeMap::new();
    let mut bytes = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name()?.into_owned();
        ensure!(
            entry.is_file()
                && !entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000)
                && (name == "manifest.json"
                    || name == "profile.yaml"
                    || EXTENSIONS.iter().any(|kind| entry_name(kind) == name)),
            "Unexpected subscription bundle entry"
        );
        ensure!(entry.size() <= MAX_BYTES - bytes, "Subscription bundle exceeds 64 MiB");
        let mut text = std::string::String::new();
        (&mut entry).take(MAX_BYTES - bytes + 1).read_to_string(&mut text)?;
        bytes += text.len() as u64;
        ensure!(bytes <= MAX_BYTES, "Subscription bundle exceeds 64 MiB");
        ensure!(
            files.insert(name, text).is_none(),
            "Duplicate subscription bundle entry"
        );
    }
    let manifest = serde_json::from_str(
        &files
            .remove("manifest.json")
            .context("Missing subscription bundle manifest")?,
    )?;
    let bundle = Bundle { manifest, files };
    bundle.validate()?;
    Ok(bundle)
}

fn write_bundle(destination: &Path, bundle: Bundle) -> Result<()> {
    bundle.validate()?;
    let temporary = destination.with_extension(format!("zip.tmp-{}", help::get_uid("export")));
    let file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let temporary = std::mem::DropGuard::new(temporary, |path| {
        let _ = std::fs::remove_file(path);
    });
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive.start_file("manifest.json", options)?;
    archive.write_all(&serde_json::to_vec(&bundle.manifest)?)?;
    for (name, text) in bundle.files {
        archive.start_file(name, options)?;
        archive.write_all(text.as_bytes())?;
    }
    let file = archive.finish()?;
    ensure!(
        file.metadata()?.len() <= MAX_BYTES,
        "Subscription bundle exceeds 64 MiB"
    );
    file.sync_all()?;
    drop(file);
    std::fs::rename(temporary.as_path(), destination)?;
    Ok(())
}

struct ImportedFiles(Vec<PathBuf>);

impl Drop for ImportedFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            if let Err(error) = std::fs::remove_file(path) {
                logging!(
                    warn,
                    Type::Config,
                    "Failed to remove uncommitted subscription file {}: {error}",
                    path.display()
                );
            }
        }
    }
}

async fn import_into(profiles: &Draft<IProfiles>, bundle: Bundle, directory: &Path, index: &Path) -> Result<()> {
    let directory = directory.to_owned();
    let written = profiles
        .with_data_modify(|mut candidate| async move {
            let mut items = bundle.into_items(&candidate)?;
            let (items, written) = tokio::task::spawn_blocking(move || -> Result<_> {
                let mut written = ImportedFiles(Vec::new());
                for item in &mut items {
                    let path = directory.join(item.file.as_deref().context("Missing generated filename")?);
                    let mut file = OpenOptions::new().write(true).create_new(true).open(&path)?;
                    written.0.push(path);
                    file.write_all(
                        item.file_data
                            .take()
                            .context("Missing subscription content")?
                            .as_bytes(),
                    )?;
                    file.sync_all()?;
                }
                Ok((items, written))
            })
            .await??;
            candidate.items.get_or_insert_default().extend(items);
            help::save_yaml(index, &candidate, Some("# Profiles Config for Clash Verge")).await?;
            Ok((candidate, written))
        })
        .await?;
    // Keep cleanup armed until the candidate has become authoritative.
    let mut written = written;
    written.0.clear();
    Ok(())
}

pub(crate) async fn export_profile_bundle(index: &str, destination: &Path) -> Result<()> {
    let guard = PROFILE_WRITE_LOCK.lock().await;
    let profiles = Config::profiles().await;
    let directory = dirs::app_profiles_dir()?;
    let index = index.to_owned();
    let bundle = profiles
        .with_data_modify(|profiles| async move {
            let snapshot = profiles.clone();
            let bundle = tokio::task::spawn_blocking(move || Bundle::capture(&snapshot, &index, &directory)).await??;
            Ok((profiles, bundle))
        })
        .await?;
    drop(guard);
    let destination = destination.to_owned();
    tokio::task::spawn_blocking(move || write_bundle(&destination, bundle)).await?
}

pub(crate) async fn import_profile_bundle(source: &Path) -> Result<()> {
    let source = source.to_owned();
    let bundle = tokio::task::spawn_blocking(move || read_bundle(&source)).await??;
    let _guard = PROFILE_WRITE_LOCK.lock().await;
    import_into(
        &Config::profiles().await,
        bundle,
        &dirs::app_profiles_dir()?,
        &dirs::profiles_path()?,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashSet, io::Cursor};

    fn workspace() -> std::mem::DropGuard<PathBuf, impl FnOnce(PathBuf)> {
        let path = std::env::temp_dir().join(format!("verge-bundle-{}", help::get_uid("test")));
        std::fs::create_dir_all(&path).unwrap();
        std::mem::DropGuard::new(path, |path| {
            let _ = std::fs::remove_dir_all(path);
        })
    }

    fn source(dir: &Path) -> IProfiles {
        let option = PrfOption {
            user_agent: Some("Synthetic client".into()),
            update_interval: Some(120),
            allow_auto_update: Some(false),
            merge: Some("source-merge".into()),
            script: Some("source-script".into()),
            rules: Some("source-rules".into()),
            proxies: Some("source-proxies".into()),
            groups: Some("source-groups".into()),
            ..Default::default()
        };
        let mut items = Vec::new();
        for kind in EXTENSIONS {
            let uid = format!("source-{kind}");
            let file = entry_name(kind);
            let content = if kind == "script" {
                "function main(config) {\n  return config;\n}\n"
            } else if kind == "merge" {
                crate::utils::tmpl::ITEM_MERGE_EMPTY
            } else {
                "prepend: []\nappend: []\ndelete: []\n"
            };
            std::fs::write(dir.join(&file), content).unwrap();
            items.push(PrfItem {
                uid: Some(uid.into()),
                itype: Some(kind.into()),
                file: Some(file.into()),
                ..Default::default()
            });
        }
        std::fs::write(dir.join("profile.yaml"), "proxies: []\nproxy-groups: []\nrules: []\n").unwrap();
        items.push(PrfItem {
            uid: Some("source".into()),
            itype: Some("remote".into()),
            name: Some("Synthetic subscription".into()),
            url: Some("https://example.invalid/subscription".into()),
            file: Some("profile.yaml".into()),
            option: Some(option),
            selected: Some(vec![super::super::PrfSelected {
                name: Some("Source group".into()),
                now: Some("Source node".into()),
            }]),
            ..Default::default()
        });
        IProfiles {
            current: Some("source".into()),
            items: Some(items),
        }
    }

    fn target(current: Option<&str>) -> IProfiles {
        IProfiles {
            current: current.map(Into::into),
            items: Some(vec![PrfItem {
                uid: Some("existing".into()),
                itype: Some("local".into()),
                file: Some("existing.yaml".into()),
                ..Default::default()
            }]),
        }
    }

    #[tokio::test]
    async fn round_trip_preserves_contents_and_allocates_disjoint_bindings() -> Result<()> {
        let root = workspace();
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        std::fs::create_dir_all(&source_dir)?;
        std::fs::create_dir_all(&target_dir)?;
        std::fs::write(target_dir.join("existing.yaml"), "rules: []\n")?;
        let source = source(&source_dir);
        let archive = root.join("subscription.zip");
        write_bundle(&archive, Bundle::capture(&source, "source", &source_dir)?)?;
        let target = Draft::new(target(Some("existing")));
        let index = root.join("profiles.yaml");
        for _ in 0..2 {
            import_into(&target, read_bundle(&archive)?, &target_dir, &index).await?;
        }
        let result = target.data_arc();
        assert_eq!(result.current.as_deref(), Some("existing"));
        let items = result.items.as_ref().unwrap();
        assert_eq!(items.len(), 13);
        let uids: HashSet<_> = items.iter().map(|item| item.uid.as_deref().unwrap()).collect();
        assert_eq!(uids.len(), 13);
        for profile in items.iter().filter(|item| item.itype.as_deref() == Some("remote")) {
            assert_eq!(profile.url.as_deref(), Some("https://example.invalid/subscription"));
            assert!(profile.selected.is_none());
            let option = profile.option.as_ref().unwrap();
            assert_eq!(option.user_agent.as_deref(), Some("Synthetic client"));
            assert_eq!(option.allow_auto_update, Some(false));
            assert_eq!(option.update_interval, Some(120));
            for (kind, reference) in [
                ("merge", &option.merge),
                ("script", &option.script),
                ("rules", &option.rules),
                ("proxies", &option.proxies),
                ("groups", &option.groups),
            ] {
                let extension = result.get_item(reference.as_ref().unwrap())?;
                assert_eq!(extension.itype.as_deref(), Some(kind));
                assert_ne!(extension.uid.as_deref(), Some(format!("source-{kind}").as_str()));
                assert_eq!(
                    std::fs::read(target_dir.join(extension.file.as_deref().unwrap()))?,
                    std::fs::read(source_dir.join(entry_name(kind)))?
                );
            }
        }
        let restarted: IProfiles = serde_yaml_ng::from_str(&std::fs::read_to_string(index)?)?;
        assert_eq!(restarted.current.as_deref(), Some("existing"));
        assert_eq!(restarted.items.as_ref().unwrap().len(), 13);
        assert_eq!(
            std::fs::read_to_string(target_dir.join("existing.yaml"))?,
            "rules: []\n"
        );
        Ok(())
    }

    #[tokio::test]
    async fn import_ignores_source_identity_and_preserves_an_empty_selection() -> Result<()> {
        let root = workspace();
        let source = source(&root);
        let mut bundle = Bundle::capture(&source, "source", &root)?;
        bundle.manifest.profile.uid = Some("existing".into());
        bundle.manifest.profile.file = Some("../outside.yaml".into());
        bundle.manifest.profile.option.as_mut().unwrap().script = Some("existing".into());
        let target = Draft::new(target(None));
        import_into(&target, bundle, &root, &root.join("profiles.yaml")).await?;
        let result = target.data_arc();
        assert!(result.current.is_none());
        assert_eq!(result.get_item("existing")?.file.as_deref(), Some("existing.yaml"));
        assert_eq!(result.items.as_ref().unwrap().len(), 7);
        for item in result.items.iter().flatten() {
            assert_eq!(Path::new(item.file.as_deref().unwrap()).components().count(), 1);
        }
        Ok(())
    }

    #[tokio::test]
    async fn failed_index_persistence_rolls_back_new_files_and_committed_state() -> Result<()> {
        let root = workspace();
        let source = source(&root);
        let bundle = Bundle::capture(&source, "source", &root)?;
        let target = Draft::new(target(Some("existing")));
        let failed_index = root.join("index-is-a-directory");
        std::fs::create_dir(&failed_index)?;
        let before: HashSet<_> = std::fs::read_dir(root.as_path())?
            .map(|entry| entry.unwrap().path())
            .collect();
        assert!(import_into(&target, bundle, &root, &failed_index).await.is_err());
        assert_eq!(target.data_arc().items.as_ref().unwrap().len(), 1);
        assert_eq!(target.data_arc().current.as_deref(), Some("existing"));
        let after: HashSet<_> = std::fs::read_dir(root.as_path())?
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(before, after);
        Ok(())
    }

    #[test]
    fn export_fails_for_missing_bound_files() -> Result<()> {
        let root = workspace();
        let source = source(&root);
        std::fs::remove_file(root.join("script.js"))?;
        assert!(Bundle::capture(&source, "source", &root).is_err());
        Ok(())
    }

    #[test]
    fn malformed_archives_are_rejected_before_import() -> Result<()> {
        let root = workspace();
        let source = source(&root);
        let bundle = Bundle::capture(&source, "source", &root)?;
        let archive = root.join("bad.zip");
        for invalid in [
            "version",
            "missing-script",
            "unexpected-entry",
            "duplicate-kind",
            "duplicate-entry",
            "invalid-yaml",
            "invalid-sequence",
            "invalid-interval",
        ] {
            let mut manifest = bundle.manifest.clone();
            let mut files = bundle.files.clone();
            match invalid {
                "version" => manifest.version = 999,
                "missing-script" => {
                    files.remove("script.js");
                }
                "unexpected-entry" => {
                    files.insert("../outside.yaml".into(), "rules: []\n".into());
                }
                "duplicate-kind" => manifest.extensions.push("script".into()),
                "duplicate-entry" => {
                    files.insert("profile.yamx".into(), "rules: [MATCH,REJECT]\n".into());
                }
                "invalid-yaml" => {
                    files.insert("profile.yaml".into(), "[not a mapping]\n".into());
                }
                "invalid-sequence" => {
                    files.insert("rules.yaml".into(), "prepend: wrong\nappend: []\ndelete: []\n".into());
                }
                "invalid-interval" => manifest.profile.option.as_mut().unwrap().update_interval = Some(u64::MAX),
                _ => unreachable!(),
            }
            let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())?;
            zip.write_all(&serde_json::to_vec(&manifest)?)?;
            for (name, content) in files {
                zip.start_file(name, zip::write::SimpleFileOptions::default())?;
                zip.write_all(content.as_bytes())?;
            }
            let mut bytes = zip.finish()?.into_inner();
            if invalid == "duplicate-entry" {
                for offset in 0..=bytes.len() - 12 {
                    if &bytes[offset..offset + 12] == b"profile.yamx" {
                        bytes[offset..offset + 12].copy_from_slice(b"profile.yaml");
                    }
                }
            }
            std::fs::write(&archive, bytes)?;
            assert!(read_bundle(&archive).is_err(), "{invalid}");
        }
        Ok(())
    }

    #[test]
    fn oversized_uncompressed_entries_are_rejected() -> Result<()> {
        let root = workspace();
        let archive = root.join("oversized.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive)?);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)?;
        zip.write_all(b"{}")?;
        zip.start_file("profile.yaml", options)?;
        let chunk = vec![b' '; 1024 * 1024];
        for _ in 0..65 {
            zip.write_all(&chunk)?;
        }
        zip.finish()?;
        assert!(read_bundle(&archive).err().unwrap().to_string().contains("64 MiB"));
        Ok(())
    }
}

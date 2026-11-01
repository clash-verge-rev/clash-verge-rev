//! In-app mihomo core upgrade.
//!
//! The core replaces itself by truncating its own running executable in place, which macOS
//! kills under Hardened Runtime and which leaves a 0-byte core behind when interrupted
//! (clash-verge-rev#6834). Verge downloads the release itself instead, stages a verified
//! copy beside the managed core and renames it into place: `rename` never touches the inode
//! the running core is executing from, so no page validation can fail.

use crate::{
    config::Config,
    core::{CoreManager, manager::RunningMode},
    utils::network::{NetworkManager, ProxyType},
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging, logging_error};
use std::{
    env::current_exe,
    ffi::OsStr,
    fs::File,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

const RELEASE_VERSION_URL: &str = "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt";
const ALPHA_BASE_URL: &str = "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha";
const RELEASE_DOWNLOAD_URL: &str = "https://github.com/MetaCubeX/mihomo/releases/download";
const VERSION_TIMEOUT_SECS: u64 = 20;
const PACKAGE_TIMEOUT_SECS: u64 = 300;
/// Well above any real core package, low enough that a wrong response cannot exhaust memory.
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;

static STAGING_GENERATION: AtomicU64 = AtomicU64::new(0);
/// `.rollback` and `.old` are fixed paths, so two upgrades must not overlap.
static UPGRADE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct CoreUpgradeReport {
    /// False when the managed core was already at the latest version.
    pub upgraded: bool,
}

pub async fn upgrade_core(force: bool) -> Result<CoreUpgradeReport> {
    let _serialized = UPGRADE_LOCK.lock().await;
    // A previous upgrade may have been interrupted between publishing and cleanup. Recover before
    // the current core is read, otherwise a broken target hides the usable backup.
    logging_error!(Type::Core, recover_interrupted_core_upgrade().await);
    let core = Config::verge().await.latest_arc().get_valid_clash_core();
    tracing::Span::current().record("core", tracing::field::display(&core));
    let alpha = core.ends_with("-alpha");
    let target = managed_core_path(&core)?;

    // A core already broken by the in-place updater cannot report a version; upgrading is the repair.
    let installed = read_core_version(&target).unwrap_or_else(|error| {
        logging!(warn, Type::Core, "core upgrade: unreadable installed core: {error:#}");
        std::string::String::new()
    });

    let (proxy, latest) = resolve_latest_version(alpha).await?;
    let span = tracing::Span::current();
    span.record("from", tracing::field::display(&installed));
    span.record("to", tracing::field::display(&latest));
    logging!(debug, Type::Core, "core upgrade: latest version resolved via {proxy:?}");

    if !force && installed == latest {
        return Ok(CoreUpgradeReport { upgraded: false });
    }

    let package = download_package(proxy, alpha, &latest).await?;
    let staged = stage_core(&target, &package, &latest)?;

    // A hard link keeps the previous core reachable without touching the inode the running
    // core executes from, so publishing below stays one atomic rename. Filesystems without
    // hard links fall back to a copy; without either, refuse to replace a working core.
    let rollback = rollback_path(&target, &core);
    let _ = std::fs::remove_file(&rollback);
    // Nothing to roll back to when the core we are replacing could not report a version.
    let restorable = if installed.is_empty() {
        false
    } else {
        backup_core(&target, &rollback).context("refusing to replace the managed core without a rollback copy")?;
        true
    };

    // Decided before anything can crash: after a failed restart the mode reads NotRunning, which
    // says nothing about whether this upgrade went through the Service.
    let service_mode = matches!(*CoreManager::global().get_running_mode(), RunningMode::Service);

    let mut result = staged.publish(&target);
    // The Service executes its own administrator-approved copy, never this file; hand the new
    // bytes over before the restart below asks for them, or a service-mode restart would keep
    // running the previous core while the app reports the new version. Sidecar mode runs the
    // file directly and gets no elevation prompt.
    let service_staging = if result.is_ok() && service_mode {
        result =
            crate::core::service::stage_approved_core(&target).context("core replaced but not accepted by the service");
        if result.is_ok() {
            ServiceStaging::Succeeded
        } else {
            ServiceStaging::Refused
        }
    } else {
        ServiceStaging::NotAttempted
    };
    if result.is_ok() {
        result = CoreManager::global()
            .restart_core()
            .await
            .context("core replaced but failed to restart");
    }

    if let Err(error) = result {
        // Put the previous core back when its file is gone or its process is down. A failure
        // after the new core started must keep the new file instead. A service that refused the
        // new core also restores: leaving the new file would make a retry read the new version
        // and report nothing to do while the service keeps running the old core.
        let core_is_down = matches!(*CoreManager::global().get_running_mode(), RunningMode::NotRunning);
        let error = rollback_failed_upgrade(
            error,
            &rollback,
            &target,
            &installed,
            restorable,
            service_staging,
            core_is_down,
            crate::core::service::stage_approved_core,
            || CoreManager::global().restart_core(),
        )
        .await;
        // Redundant once the rollback succeeded; without a working target it may be the only copy left.
        #[cfg(windows)]
        if restorable && target.exists() && !rollback.exists() {
            let _ = std::fs::remove_file(target.with_extension("old"));
        }
        return Err(error);
    }
    let _ = std::fs::remove_file(&rollback);
    // The displaced core could not be deleted while it was still executing.
    #[cfg(windows)]
    let _ = std::fs::remove_file(target.with_extension("old"));

    Ok(CoreUpgradeReport { upgraded: true })
}

/// The rollback copy is kept until the target, its service copy, and the restarted process are usable.
#[allow(clippy::too_many_arguments)]
async fn rollback_failed_upgrade<StageService, Restart, RestartFuture>(
    error: anyhow::Error,
    rollback: &Path,
    target: &Path,
    installed: &str,
    restorable: bool,
    service_staging: ServiceStaging,
    core_is_down: bool,
    stage_service: StageService,
    restart_core: Restart,
) -> anyhow::Error
where
    StageService: FnOnce(&Path) -> Result<()>,
    Restart: FnOnce() -> RestartFuture,
    RestartFuture: std::future::Future<Output = Result<()>>,
{
    if !restorable || !(matches!(service_staging, ServiceStaging::Refused) || core_is_down || !target.exists()) {
        let _ = std::fs::remove_file(rollback);
        return error;
    }

    match restore_backup(rollback, target) {
        Ok(()) => {
            logging!(warn, Type::Core, "core upgrade: rolled back to {installed:?}");
            let mut error = error;
            // Only a staging that SUCCEEDED left the failing bytes in the approved copy, and only
            // then must the restore reach it too — otherwise the restart below would spawn the
            // very core that just failed. Refused or never-attempted staging left the approved
            // copy untouched, and re-staging would raise an elevation prompt for a no-op. This is
            // deliberately not gated on the current running mode, which reads NotRunning after
            // the very crash being rolled back.
            let stage_error = if matches!(service_staging, ServiceStaging::Succeeded) {
                stage_service(target).err()
            } else {
                None
            };
            let stage_failed = stage_error.is_some();
            if let Some(stage_error) = stage_error {
                logging!(
                    warn,
                    Type::Core,
                    "core upgrade: could not restore the service copy: {stage_error:#}"
                );
                error = error.context(format!(
                    "the previous core was restored but the service copy could not be updated; \
                     the backup was kept at {}: {stage_error:#}",
                    rollback.display()
                ));
            }
            let restart_error = if core_is_down { restart_core().await.err() } else { None };
            let restart_failed = restart_error.is_some();
            if let Some(restart_error) = restart_error {
                logging!(
                    error,
                    Type::Core,
                    "core upgrade: restored core failed to restart: {restart_error:#}"
                );
                error = error.context(format!(
                    "the previous core was restored but failed to restart; the backup was kept at {}: \
                     {restart_error:#}",
                    rollback.display()
                ));
            }
            if !stage_failed && !restart_failed {
                let _ = std::fs::remove_file(rollback);
            }
            error
        }
        Err(restore_error) => {
            logging!(
                error,
                Type::Core,
                "core upgrade: failed to restore {}: {restore_error:#}",
                rollback.display()
            );
            error.context(format!(
                "the previous core could not be restored; the backup was kept at {}: {restore_error:#}",
                rollback.display()
            ))
        }
    }
}

/// Whether this upgrade handed bytes to the Service's approved core directory.
///
/// Three states matter, not two: a staging that never ran (publish failed, or sidecar mode) left
/// the approved copy alone just like a refused one, but only a SUCCEEDED staging obliges the
/// rollback path to restore that copy as well. A user who upgrades in sidecar mode and later
/// switches to service mode runs the previously approved core until the next elevated
/// (re)install or upgrade; the Service logs that drift on every spawn.
#[derive(Clone, Copy)]
enum ServiceStaging {
    NotAttempted,
    Succeeded,
    Refused,
}

fn rollback_path(target: &Path, core: &str) -> PathBuf {
    target.with_file_name(format!(".{core}.rollback"))
}

fn meta_backup_path(target: &Path) -> Option<PathBuf> {
    Some(target.parent()?.join("meta-backup").join(target.file_name()?))
}

fn backup_core(target: &Path, rollback: &Path) -> Result<()> {
    let _ = std::fs::remove_file(rollback);
    match std::fs::hard_link(target, rollback) {
        Ok(()) => Ok(()),
        Err(link_error) => stage_file_from(target, rollback)
            .and_then(|staged| {
                std::fs::rename(&staged.path, rollback)
                    .with_context(|| format!("failed to publish {}", rollback.display()))
            })
            .with_context(|| {
                format!(
                    "failed to back up {} to {} (hard link failed: {link_error})",
                    target.display(),
                    rollback.display()
                )
            }),
    }
}

/// Stages a synced copy of `source` beside `destination`. Syncing on the write handle avoids
/// Windows `FlushFileBuffers` (`ERROR_ACCESS_DENIED` on read-only handles), and `StagedCore`
/// cleans up the temporary file if publishing fails.
fn stage_file_from(source: &Path, destination: &Path) -> Result<StagedCore> {
    let directory = destination
        .parent()
        .with_context(|| format!("the managed core has no parent directory: {}", destination.display()))?;
    let core_name = destination
        .file_name()
        .with_context(|| format!("the managed core has no file name: {}", destination.display()))?;

    let (path, mut file) = create_staging_file(directory, core_name)?;
    let staged = StagedCore { path };
    let mut reader = File::open(source).with_context(|| format!("failed to open {}", source.display()))?;
    std::io::copy(&mut reader, &mut file)
        .with_context(|| format!("failed to copy {} to {}", source.display(), staged.path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;

        file.set_permissions(std::fs::Permissions::from_mode(0o755))
            .with_context(|| format!("failed to make {} executable", staged.path.display()))?;
    }

    file.sync_all()
        .with_context(|| format!("failed to flush {}", staged.path.display()))?;
    drop(file);

    Ok(staged)
}

fn restore_backup(rollback: &Path, target: &Path) -> Result<()> {
    let staged = stage_file_from(rollback, target)?;
    // When restoring from `.old`, avoid `StagedCore::publish`'s `.old` displacement fallback so a
    // failed rename cannot overwrite the backup being restored.
    if rollback == target.with_extension("old") {
        std::fs::rename(&staged.path, target)
            .with_context(|| format!("failed to restore the core from {}", rollback.display()))
    } else {
        staged
            .publish(target)
            .with_context(|| format!("failed to restore the core from {}", rollback.display()))
    }
}

/// `.rollback` only exists when a prior upgrade was interrupted after backing up or could not
/// complete its rollback, so a runnable `.rollback` takes precedence even when `target` is a
/// runnable new binary that was never accepted by the service or runtime config.
fn recover_core(
    target: &Path,
    rollback: &Path,
    displaced: &Path,
    meta_backup: Option<&Path>,
    is_runnable: impl Fn(&Path) -> bool,
) -> Result<Option<PathBuf>> {
    if rollback.exists() && is_runnable(rollback) {
        restore_backup(rollback, target)?;
        let _ = std::fs::remove_file(rollback);
        let _ = std::fs::remove_file(displaced);
        return Ok(Some(rollback.to_path_buf()));
    }

    if is_runnable(target) {
        let _ = std::fs::remove_file(rollback);
        let _ = std::fs::remove_file(displaced);
        return Ok(None);
    }

    for backup in [Some(displaced), meta_backup].into_iter().flatten() {
        if !backup.exists() || !is_runnable(backup) {
            continue;
        }
        restore_backup(backup, target)?;
        let _ = std::fs::remove_file(rollback);
        let _ = std::fs::remove_file(displaced);
        return Ok(Some(backup.to_path_buf()));
    }

    Ok(None)
}

fn is_runnable_core(path: &Path) -> bool {
    #[cfg(unix)]
    if let Ok(metadata) = std::fs::metadata(path) {
        use std::os::unix::fs::PermissionsExt as _;

        let permissions = metadata.permissions();
        if permissions.mode() & 0o111 == 0 {
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
        }
    }
    read_core_version(path).is_ok()
}

pub async fn recover_interrupted_core_upgrade() -> Result<()> {
    let core = Config::verge().await.latest_arc().get_valid_clash_core();
    let target = managed_core_path(&core)?;
    let rollback = rollback_path(&target, &core);
    let displaced = target.with_extension("old");
    let meta_backup = meta_backup_path(&target);
    let target_present = std::fs::metadata(&target).is_ok_and(|meta| meta.len() > 0);
    // Avoid spawning `<core> -v` on normal startups when no upgrade artifacts exist.
    if target_present && !rollback.exists() && !displaced.exists() {
        return Ok(());
    }
    if !target_present
        && !rollback.exists()
        && !displaced.exists()
        && !meta_backup.as_ref().is_some_and(|path| path.exists())
    {
        return Ok(());
    }

    if let Some(backup) = recover_core(&target, &rollback, &displaced, meta_backup.as_deref(), is_runnable_core)? {
        logging!(
            warn,
            Type::Core,
            "core upgrade: restored {} from the interrupted upgrade backup {}",
            target.display(),
            backup.display()
        );
    }
    Ok(())
}

/// The sidecar next to the app executable. On macOS development builds the Service runs a
/// staged copy of this file, so writing here is what makes an upgrade survive the next start.
fn managed_core_path(core: &str) -> Result<PathBuf> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let path = current_exe()
        .context("failed to locate the current executable")?
        .with_file_name(format!("{core}{extension}"));
    Ok(path)
}

/// Pins the package to the resolved version, so a release moving on mid-upgrade cannot 404.
fn package_url(alpha: bool, version: &str) -> Result<std::string::String> {
    let asset = asset_base_name(alpha)?;
    let extension = if cfg!(windows) { "zip" } else { "gz" };
    Ok(if alpha {
        format!("{ALPHA_BASE_URL}/{asset}-{version}.{extension}")
    } else {
        format!("{RELEASE_DOWNLOAD_URL}/{version}/{asset}-{version}.{extension}")
    })
}

/// Mirrors the asset map in `scripts/prebuild.mjs` so an upgrade keeps the build variant
/// the bundled sidecar was taken from.
fn asset_base_name(alpha: bool) -> Result<&'static str> {
    let arch = std::env::consts::ARCH;
    let unsupported = || anyhow!("no mihomo release asset for {}-{arch}", std::env::consts::OS);

    let name = if cfg!(target_os = "windows") {
        match arch {
            "x86_64" => "mihomo-windows-amd64-v2",
            "x86" => "mihomo-windows-386",
            "aarch64" => "mihomo-windows-arm64",
            _ => return Err(unsupported()),
        }
    } else if cfg!(target_os = "macos") {
        match arch {
            "x86_64" if alpha => "mihomo-darwin-amd64-v1-go122",
            "x86_64" => "mihomo-darwin-amd64-v2-go122",
            "aarch64" => "mihomo-darwin-arm64-go122",
            _ => return Err(unsupported()),
        }
    } else {
        match arch {
            "x86_64" => "mihomo-linux-amd64-v2",
            "x86" => "mihomo-linux-386",
            "aarch64" => "mihomo-linux-arm64",
            "arm" => "mihomo-linux-armv7",
            "riscv64" => "mihomo-linux-riscv64",
            "loongarch64" => "mihomo-linux-loong64",
            _ => return Err(unsupported()),
        }
    };
    Ok(name)
}

/// Returns the proxy that reached GitHub so the package download reuses it.
#[tracing::instrument(skip_all, level = "debug", fields(alpha))]
async fn resolve_latest_version(alpha: bool) -> Result<(ProxyType, std::string::String)> {
    let url = if alpha {
        format!("{ALPHA_BASE_URL}/version.txt")
    } else {
        RELEASE_VERSION_URL.to_owned()
    };
    let mut last_error = None;

    for proxy in [ProxyType::Localhost, ProxyType::System, ProxyType::None] {
        let attempt = NetworkManager::new()
            .get(&url, proxy, Some(VERSION_TIMEOUT_SECS), None, false)
            .await;

        match attempt {
            Ok(response) if response.status().is_success() => {
                // An error page answered with 200 must not become a version, nor reach the URL.
                let version = response.text().trim().to_owned();
                if !is_usable_version(&version) {
                    logging!(
                        warn,
                        Type::Core,
                        "core upgrade: {url} returned an unusable version: {version:?}"
                    );
                    last_error = Some(anyhow!("{url} returned an unusable version"));
                    continue;
                }
                return Ok((proxy, version));
            }
            Ok(response) => {
                logging!(
                    debug,
                    Type::Core,
                    "core upgrade: version probe via {proxy:?}: status {}",
                    response.status()
                );
                last_error = Some(anyhow!("{url} returned status {}", response.status()));
            }
            Err(error) => {
                logging!(
                    debug,
                    Type::Core,
                    "core upgrade: version probe via {proxy:?} failed: {error:#}"
                );
                last_error = Some(error.context(format!("{proxy:?} could not reach {url}")));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("failed to read the latest core version from {url}")))
}

/// Keeps error pages, and anything that could steer the package URL, out of the version.
fn is_usable_version(version: &str) -> bool {
    version.starts_with(|c: char| c.is_ascii_alphanumeric())
        && version.len() <= 64
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

async fn download_package(proxy: ProxyType, alpha: bool, version: &str) -> Result<Vec<u8>> {
    let url = package_url(alpha, version)?;
    logging!(info, Type::Core, "core upgrade: downloading {url}");

    NetworkManager::new()
        .get_bytes(&url, proxy, Some(PACKAGE_TIMEOUT_SECS), MAX_PACKAGE_BYTES)
        .await
        .with_context(|| format!("failed to download {url}"))
}

/// A staged core that is removed unless publishing renamed it away.
struct StagedCore {
    path: PathBuf,
}

impl Drop for StagedCore {
    fn drop(&mut self) {
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => logging!(
                warn,
                Type::Core,
                "core upgrade: failed to clean {}: {error}",
                self.path.display()
            ),
        }
    }
}

/// Unpacks, permits, signs and runs the new core before it is allowed anywhere near the
/// live path, so a bad download can never replace a working core.
fn stage_core(target: &Path, package: &[u8], version: &str) -> Result<StagedCore> {
    let directory = target
        .parent()
        .with_context(|| format!("the managed core has no parent directory: {}", target.display()))?;
    let core_name = target
        .file_name()
        .with_context(|| format!("the managed core has no file name: {}", target.display()))?;

    let (path, mut file) = create_staging_file(directory, core_name)?;
    let staged = StagedCore { path };

    unpack(package, &mut file).with_context(|| format!("failed to unpack the core package for {version}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;

        let mut permissions = file
            .metadata()
            .with_context(|| format!("failed to inspect {}", staged.path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        file.set_permissions(permissions)
            .with_context(|| format!("failed to make {} executable", staged.path.display()))?;
    }

    file.sync_all()
        .with_context(|| format!("failed to flush {}", staged.path.display()))?;
    drop(file);

    let staged_version = read_core_version(&staged.path).context("the staged core is not runnable")?;
    if staged_version != version {
        bail!("the staged core reports {staged_version}, expected {version}");
    }

    Ok(staged)
}

fn create_staging_file(directory: &Path, core_name: &OsStr) -> Result<(PathBuf, File)> {
    use crate::utils::retry::{RetryError, RetryPolicy, retry_sync};
    retry_sync(
        RetryPolicy::fixed(
            std::num::NonZeroUsize::MIN.saturating_add(31),
            std::time::Duration::ZERO,
        ),
        |_| {
            let generation = STAGING_GENERATION.fetch_add(1, Ordering::Relaxed);
            let path = directory.join(format!(
                ".{}.{}.{generation}.tmp",
                core_name.to_string_lossy(),
                std::process::id()
            ));

            match File::options().write(true).create_new(true).open(&path) {
                Ok(file) => Ok((path, file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(RetryError::Retry(
                    anyhow::anyhow!("failed to create a unique staging file in {}", directory.display()),
                )),
                Err(error) => Err(RetryError::Stop(
                    anyhow::Error::from(error).context(format!("failed to create {}", path.display())),
                )),
            }
        },
    )
}

#[cfg(windows)]
fn unpack(package: &[u8], out: &mut File) -> Result<()> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(package)).context("invalid core archive")?;
    let mut entry = archive.by_index(0).context("the core archive is empty")?;
    std::io::copy(&mut entry, out).context("failed to extract the core")?;
    Ok(())
}

#[cfg(not(windows))]
fn unpack(package: &[u8], out: &mut File) -> Result<()> {
    let mut decoder = flate2::read::GzDecoder::new(package);
    std::io::copy(&mut decoder, out).context("failed to decompress the core")?;
    Ok(())
}

impl StagedCore {
    #[cfg(not(windows))]
    fn publish(self, target: &Path) -> Result<()> {
        std::fs::rename(&self.path, target)
            .with_context(|| format!("failed to publish the core to {}", target.display()))
    }

    #[cfg(windows)]
    fn publish(self, target: &Path) -> Result<()> {
        if std::fs::rename(&self.path, target).is_ok() {
            return Ok(());
        }

        // A running executable cannot be replaced on Windows, but it can be moved aside.
        let displaced = target.with_extension("old");
        let _ = std::fs::remove_file(&displaced);
        std::fs::rename(target, &displaced)
            .with_context(|| format!("failed to move the running core aside from {}", target.display()))?;

        if let Err(error) = std::fs::rename(&self.path, target) {
            // Say where the old core went when it cannot be put back either.
            return match std::fs::rename(&displaced, target) {
                Ok(()) => Err(error).with_context(|| format!("failed to publish the core to {}", target.display())),
                Err(restore) => Err(error).with_context(|| {
                    format!(
                        "failed to publish the core to {} and to restore it from {}: {restore}",
                        target.display(),
                        displaced.display()
                    )
                }),
            };
        }

        let _ = std::fs::remove_file(&displaced);
        Ok(())
    }
}

/// Keeps the `-v` probe and codesign from flashing a console window.
#[cfg(windows)]
fn new_command(program: impl AsRef<OsStr>) -> Command {
    use std::os::windows::process::CommandExt as _;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn new_command(program: impl AsRef<OsStr>) -> Command {
    Command::new(program)
}

/// Parses the version out of `Mihomo Meta v1.19.30 darwin arm64 with go1.22.12 ...`.
fn read_core_version(path: &Path) -> Result<std::string::String> {
    let output = new_command(path)
        .arg("-v")
        .output()
        .with_context(|| format!("failed to run {} -v", path.display()))?;

    if !output.status.success() {
        bail!("{} -v exited with {}", path.display(), output.status);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .split_whitespace()
        .nth(2)
        .filter(|version| is_usable_version(version))
        .map(str::to_owned)
        .with_context(|| format!("unexpected version output from {}: {stdout}", path.display()))
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::is_runnable_core;
    #[cfg(unix)]
    use super::read_core_version;
    use super::{
        ServiceStaging, backup_core, is_usable_version, meta_backup_path, package_url, recover_core, restore_backup,
        rollback_failed_upgrade, stage_file_from,
    };
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> anyhow::Result<PathBuf> {
        let dir = std::env::temp_dir().join(format!("clash-verge-core-upgrade-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    fn runnable(path: &Path, expected: &[u8]) -> bool {
        std::fs::read(path).is_ok_and(|bytes| bytes == expected)
    }

    #[cfg(unix)]
    fn write_fake_core(path: &Path, version: &str, mode: u32) -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, format!("#!/bin/sh\necho \"Mihomo Meta {version} unix test\"\n"))?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
        Ok(())
    }

    #[test]
    fn backup_stages_synced_fallback_and_aborts_on_failure() -> anyhow::Result<()> {
        let dir = scratch("backup")?;
        let target = dir.join("verge-mihomo");
        let rollback = dir.join(".verge-mihomo.rollback");
        std::fs::write(&target, b"old")?;

        backup_core(&target, &rollback)?;
        assert_eq!(std::fs::read(&rollback)?, b"old");

        // Exercise the copy fallback used when `hard_link` is unavailable.
        let copied = dir.join(".verge-mihomo.copy");
        let staged = stage_file_from(&target, &copied)?;
        std::fs::rename(&staged.path, &copied)?;
        assert_eq!(std::fs::read(&copied)?, b"old");

        let replacement = dir.join("verge-mihomo.new");
        std::fs::write(&replacement, b"new")?;
        #[cfg(windows)]
        std::fs::remove_file(&target)?;
        std::fs::rename(&replacement, &target)?;
        restore_backup(&rollback, &target)?;
        assert_eq!(std::fs::read(&target)?, b"old");
        assert!(rollback.exists());

        let impossible = dir.join("missing").join(".verge-mihomo.rollback");
        assert!(backup_core(&target, &impossible).is_err());
        assert_eq!(std::fs::read(&target)?, b"old");

        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }

    #[tokio::test]
    async fn rollback_keeps_backup_and_surfaces_restore_and_restart_failures() -> anyhow::Result<()> {
        let dir = scratch("rollback-errors")?;
        let target = dir.join("verge-mihomo");
        let rollback = dir.join(".verge-mihomo.rollback");
        std::fs::write(&rollback, b"previous")?;
        // A non-empty directory at `target` makes publishing the restored copy fail.
        std::fs::create_dir_all(&target)?;
        std::fs::write(target.join("busy"), b"x")?;

        let error = rollback_failed_upgrade(
            anyhow::anyhow!("core replaced but failed to restart"),
            &rollback,
            &target,
            "v1.19.29",
            true,
            ServiceStaging::NotAttempted,
            true,
            |_| Ok(()),
            || async { Ok(()) },
        )
        .await;
        let detail = format!("{error:#}");
        assert!(rollback.exists());
        assert!(detail.contains(&rollback.display().to_string()), "{detail}");

        std::fs::remove_dir_all(&target)?;
        std::fs::write(&target, b"broken-new")?;
        let error = rollback_failed_upgrade(
            anyhow::anyhow!("core replaced but failed to restart"),
            &rollback,
            &target,
            "v1.19.29",
            true,
            ServiceStaging::NotAttempted,
            true,
            |_| Ok(()),
            || async { Err(anyhow::anyhow!("ipc socket refused")) },
        )
        .await;
        let detail = format!("{error:#}");
        assert_eq!(std::fs::read(&target)?, b"previous");
        assert!(rollback.exists());
        assert!(detail.contains("ipc socket refused"), "{detail}");

        let _ = rollback_failed_upgrade(
            anyhow::anyhow!("core replaced but failed to restart"),
            &rollback,
            &target,
            "v1.19.29",
            true,
            ServiceStaging::NotAttempted,
            true,
            |_| Ok(()),
            || async { Ok(()) },
        )
        .await;
        assert!(!rollback.exists());

        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }

    #[test]
    fn recovery_prefers_pending_rollback_and_falls_back_through_backups() -> anyhow::Result<()> {
        let dir = scratch("recover")?;
        let target = dir.join("verge-mihomo");
        let rollback = dir.join(".verge-mihomo.rollback");
        let displaced = dir.join("verge-mihomo.old");
        let meta = meta_backup_path(&target).unwrap_or_else(|| dir.join("meta-backup/verge-mihomo"));
        if let Some(parent) = meta.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // An interrupted upgrade leaves a runnable new binary at `target` alongside `.rollback`;
        // `.rollback` must win so a core rejected by the service or runtime config is reverted.
        std::fs::write(&target, b"unaccepted-new")?;
        std::fs::write(&rollback, b"previous")?;
        let restored = recover_core(&target, &rollback, &displaced, Some(&meta), |path| {
            runnable(path, b"unaccepted-new") || runnable(path, b"previous")
        })?;
        assert_eq!(restored.as_deref(), Some(rollback.as_path()));
        assert_eq!(std::fs::read(&target)?, b"previous");
        assert!(!rollback.exists());

        // Once `.rollback` is gone, a healthy target cleans up stale `.old` without restoring.
        std::fs::write(&displaced, b"stale")?;
        let restored = recover_core(&target, &rollback, &displaced, Some(&meta), |path| {
            runnable(path, b"previous")
        })?;
        assert_eq!(restored, None);
        assert!(!displaced.exists());

        // When `target`, `.rollback`, and `.old` are all broken, `meta-backup/` is restored and kept.
        std::fs::write(&target, b"broken")?;
        std::fs::write(&rollback, b"bad")?;
        std::fs::write(&displaced, b"also-bad")?;
        std::fs::write(&meta, b"from-meta")?;
        let restored = recover_core(&target, &rollback, &displaced, Some(&meta), |path| {
            runnable(path, b"from-meta")
        })?;
        assert_eq!(restored.as_deref(), Some(meta.as_path()));
        assert_eq!(std::fs::read(&target)?, b"from-meta");
        assert!(!rollback.exists());
        assert!(!displaced.exists());
        assert!(meta.exists());

        #[cfg(unix)]
        {
            std::fs::write(&target, b"")?;
            write_fake_core(&rollback, "<html>bad</html>", 0o755)?;
            // `meta-backup` without `+x` is made executable before the version probe runs.
            write_fake_core(&meta, "v1.19.28", 0o644)?;
            let restored = recover_core(&target, &rollback, &displaced, Some(&meta), is_runnable_core)?;
            assert_eq!(restored.as_deref(), Some(meta.as_path()));
            assert_eq!(read_core_version(&target)?, "v1.19.28");
        }

        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }

    #[test]
    fn only_plain_version_tokens_reach_the_package_url() {
        assert!(is_usable_version("v1.19.30"));
        assert!(is_usable_version("alpha-c0e43eb"));
        for rejected in [
            "",
            ".",
            "..",
            "/etc/passwd",
            "v1.19.30 extra",
            "<html>nope</html>",
            &"v".repeat(65),
        ] {
            assert!(!is_usable_version(rejected), "accepted {rejected:?}");
        }
    }

    #[test]
    fn package_urls_pin_the_resolved_version() {
        let release = package_url(false, "v1.19.30").unwrap_or_default();
        let alpha = package_url(true, "alpha-c0e43eb").unwrap_or_default();
        assert!(release.contains("/releases/download/v1.19.30/"), "{release}");
        assert!(
            release.ends_with("-v1.19.30.gz") || release.ends_with("-v1.19.30.zip"),
            "{release}"
        );
        assert!(alpha.contains("/Prerelease-Alpha/"), "{alpha}");
    }
}

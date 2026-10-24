//! In-app mihomo core upgrade.
//!
//! The core replaces itself by truncating its own running executable in place, which macOS
//! kills under Hardened Runtime and which leaves a 0-byte core behind when interrupted
//! (clash-verge-rev#6834). Verge downloads the release itself instead, stages a verified
//! copy beside the managed core and renames it into place: `rename` never touches the inode
//! the running core is executing from, so no page validation can fail.
//!
//! Package installs break that assumption: distribution packages put the core beside the app in
//! a root-owned directory such as `/usr/bin`, which the desktop user cannot write. Those stage in
//! user data and publish through the elevated helper, which keeps the same copy-then-rename shape.

#[cfg(not(windows))]
use crate::core::service::{SERVICE_MANAGER, ServiceStatus};
use crate::{
    config::Config,
    core::{CoreManager, manager::RunningMode},
    utils::{
        dirs,
        network::{NetworkManager, ProxyType},
    },
};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging};
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
/// User data root for the staging and rollback copies of a core the app cannot write in place.
const CORE_STAGING_DIR: &str = "core-upgrade";

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
    let elevated = staged.elevated;

    // A hard link keeps the previous core reachable without touching the inode the running
    // core executes from, so publishing below stays one atomic rename. A root-owned target
    // cannot take a link beside it, so those installs keep the copy in user data instead.
    let rollback = rollback_path(&target, elevated)?;
    let _ = std::fs::remove_file(&rollback);
    // Nothing to roll back to when the core we are replacing could not report a version.
    let restorable = !installed.is_empty() && stage_rollback(&target, &rollback, elevated);

    // Decided before anything can crash: after a failed restart the mode reads NotRunning, which
    // says nothing about whether this upgrade went through the Service.
    let service_mode = matches!(*CoreManager::global().get_running_mode(), RunningMode::Service);
    // A sidecar session still owes the Service its copy when one is installed, or a later switch
    // would keep running the core this upgrade replaced while the app reports the new version.
    // Windows keeps its previous behaviour: staging there would add a UAC prompt to an upgrade
    // that never asked for one.
    #[cfg(windows)]
    let service_present = service_mode;
    #[cfg(not(windows))]
    let service_present = service_mode || service_installed().await;

    // The Service executes its own administrator-approved copy, never this file; hand the new
    // bytes over before the restart below asks for them.
    let (mut result, service_staging) = publish_core(&staged, &target, service_present);
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
        let restore_service = matches!(service_staging, ServiceStaging::Succeeded);
        if restorable
            && (matches!(service_staging, ServiceStaging::Refused) || core_is_down || !target.exists())
            && restore_core(&rollback, &target, elevated, restore_service)
        {
            logging!(warn, Type::Core, "core upgrade: rolled back to {installed:?}");
            // The elevated restore already wrote the Service copy in the same run; a local one
            // only touched the file beside the app, and re-staging would raise an elevation
            // prompt for a no-op when nothing was published. This is deliberately not gated on
            // the current running mode, which reads NotRunning after the very crash being
            // rolled back.
            if !elevated
                && restore_service
                && let Err(stage_error) = crate::core::service::stage_approved_core(&target)
            {
                logging!(
                    warn,
                    Type::Core,
                    "core upgrade: could not restore the service copy: {stage_error:#}"
                );
            }
            if core_is_down {
                let _ = CoreManager::global().restart_core().await;
            }
        }
        // Renaming one hard link over the other succeeds without consuming the name.
        let _ = std::fs::remove_file(&rollback);
        // Redundant once the rollback link exists; without one it is the only copy left.
        #[cfg(windows)]
        if restorable {
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

/// Whether this upgrade handed bytes to the Service's approved core directory.
///
/// Three states matter, not two: a staging that never ran (publish failed, or no Service is
/// installed) left the approved copy alone just like a refused one, but only a SUCCEEDED staging
/// obliges the rollback path to restore that copy as well. A sidecar session with an installed
/// Service stages too, so switching back cannot run the core this upgrade replaced.
#[derive(Clone, Copy)]
enum ServiceStaging {
    NotAttempted,
    Succeeded,
    Refused,
}

/// True when a Service is registered, whatever its current health: its approved copy outlives
/// this session, so an upgrade in sidecar mode still has to refresh it.
#[cfg(not(windows))]
async fn service_installed() -> bool {
    !matches!(
        SERVICE_MANAGER.current().await,
        ServiceStatus::Checking
            | ServiceStatus::NotInstalled
            | ServiceStatus::InstallRequired
            | ServiceStatus::SidecarAllowed
    )
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
    /// The target directory is root-owned, so publishing has to go through the elevated helper.
    elevated: bool,
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
    let elevated = publish_requires_elevation(target);
    let directory = staging_directory(target, elevated)?;
    let core_name = target
        .file_name()
        .with_context(|| format!("the managed core has no file name: {}", target.display()))?;

    let (path, mut file) = create_staging_file(&directory, core_name)?;
    let staged = StagedCore { path, elevated };

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
    fn publish(&self, target: &Path) -> Result<()> {
        std::fs::rename(&self.path, target)
            .with_context(|| format!("failed to publish the core to {}", target.display()))
    }

    #[cfg(windows)]
    fn publish(&self, target: &Path) -> Result<()> {
        debug_assert!(!self.elevated);
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

/// Publishing next to the target needs write access to its directory. Distribution packages
/// install the core in a root-owned directory such as `/usr/bin`, so those publish through the
/// elevated helper.
#[cfg(target_os = "linux")]
fn publish_requires_elevation(target: &Path) -> bool {
    target
        .parent()
        .is_some_and(|directory| !directory_is_writable(directory))
}

/// Only Linux installs the core into a directory the desktop user cannot write.
#[cfg(not(target_os = "linux"))]
const fn publish_requires_elevation(_target: &Path) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn directory_is_writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;

    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: a valid NUL-terminated path is readable for the duration of the call.
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

fn staging_directory(target: &Path, elevated: bool) -> Result<PathBuf> {
    if !elevated {
        return target
            .parent()
            .map(Path::to_path_buf)
            .with_context(|| format!("the managed core has no parent directory: {}", target.display()));
    }

    let directory = dirs::app_home_dir()?.join(CORE_STAGING_DIR);
    std::fs::create_dir_all(&directory)
        .with_context(|| format!("failed to create the core staging directory {}", directory.display()))?;
    Ok(directory)
}

fn rollback_path(target: &Path, elevated: bool) -> Result<PathBuf> {
    let name = target
        .file_name()
        .with_context(|| format!("the managed core has no file name: {}", target.display()))?;
    let name = format!(".{}.rollback", name.to_string_lossy());

    if elevated {
        Ok(dirs::app_home_dir()?.join(CORE_STAGING_DIR).join(name))
    } else {
        Ok(target.with_file_name(name))
    }
}

/// Keeps the previous bytes reachable for the rollback. A hard link cannot be created beside a
/// root-owned target, so those copies are read into user data instead.
fn stage_rollback(target: &Path, rollback: &Path, elevated: bool) -> bool {
    if elevated {
        std::fs::copy(target, rollback).is_ok()
    } else {
        std::fs::hard_link(target, rollback).is_ok()
    }
}

/// Publishes the verified core, then the Service's approved copy when one is installed.
///
/// A refused Service copy leaves the new core on disk, so it is reported apart from a replacement
/// that never happened: only the former restores the Service copy during rollback.
fn publish_core(staged: &StagedCore, target: &Path, service_present: bool) -> (Result<()>, ServiceStaging) {
    if staged.elevated {
        return match publish_elevated(&staged.path, target, service_present) {
            Ok(ElevatedOutcome::Published) => (
                Ok(()),
                if service_present {
                    ServiceStaging::Succeeded
                } else {
                    ServiceStaging::NotAttempted
                },
            ),
            Ok(ElevatedOutcome::ServiceFailed(error)) => (
                Err(error.context("core replaced but not accepted by the service")),
                ServiceStaging::Refused,
            ),
            Err(error) => (Err(error), ServiceStaging::NotAttempted),
        };
    }

    if let Err(error) = staged.publish(target) {
        return (Err(error), ServiceStaging::NotAttempted);
    }
    if !service_present {
        return (Ok(()), ServiceStaging::NotAttempted);
    }

    match crate::core::service::stage_approved_core(target) {
        Ok(()) => (Ok(()), ServiceStaging::Succeeded),
        Err(error) => (
            Err(error.context("core replaced but not accepted by the service")),
            ServiceStaging::Refused,
        ),
    }
}

/// How far an elevated replacement got, without tying the upgrade to the platform's module.
///
/// Only Linux reaches this path: elsewhere the core never lands in a directory the user cannot
/// write, so neither variant is ever constructed.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
enum ElevatedOutcome {
    Published,
    ServiceFailed(anyhow::Error),
}

#[cfg(target_os = "linux")]
fn publish_elevated(staged: &Path, target: &Path, publish_service: bool) -> Result<ElevatedOutcome> {
    logging!(
        info,
        Type::Core,
        "core upgrade: requesting elevation to replace {}",
        target.display()
    );
    Ok(
        match crate::utils::elevated::replace_root_owned_file(staged, target, publish_service)? {
            crate::utils::elevated::Outcome::Published => ElevatedOutcome::Published,
            crate::utils::elevated::Outcome::ServiceFailed(error) => ElevatedOutcome::ServiceFailed(error),
        },
    )
}

#[cfg(not(target_os = "linux"))]
fn publish_elevated(staged: &Path, target: &Path, _publish_service: bool) -> Result<ElevatedOutcome> {
    bail!(
        "replacing the root-owned core {} is not supported on this platform (staged at {})",
        target.display(),
        staged.display()
    )
}

fn restore_core(rollback: &Path, target: &Path, elevated: bool, publish_service: bool) -> bool {
    if !elevated {
        return std::fs::rename(rollback, target).is_ok();
    }

    match publish_elevated(rollback, target, publish_service) {
        Ok(ElevatedOutcome::Published) => true,
        // The previous core is back in place; only the Service copy is stale, and the next
        // successful publish repairs it.
        Ok(ElevatedOutcome::ServiceFailed(error)) => {
            logging!(
                warn,
                Type::Core,
                "core upgrade: restored {} but not the service copy: {error:#}",
                target.display()
            );
            true
        }
        Err(error) => {
            logging!(
                warn,
                Type::Core,
                "core upgrade: failed to restore {}: {error:#}",
                target.display()
            );
            false
        }
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
        .map(str::to_owned)
        .with_context(|| format!("unexpected version output from {}: {stdout}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{is_usable_version, package_url};

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

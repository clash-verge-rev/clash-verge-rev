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

static STAGING_GENERATION: AtomicU64 = AtomicU64::new(0);
/// `.rollback` and `.old` are fixed paths, so two upgrades must not overlap.
static UPGRADE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, serde::Serialize)]
pub struct CoreUpgradeReport {
    /// False when the managed core was already at the latest version.
    pub upgraded: bool,
    pub from: std::string::String,
    pub to: std::string::String,
}

pub async fn upgrade_core(force: bool) -> Result<CoreUpgradeReport> {
    let _serialized = UPGRADE_LOCK.lock().await;
    let core = Config::verge().await.latest_arc().get_valid_clash_core();
    let alpha = core.ends_with("-alpha");
    let target = managed_core_path(&core)?;

    // A core already broken by the in-place updater cannot report a version; upgrading is the repair.
    let installed = read_core_version(&target).unwrap_or_else(|error| {
        logging!(warn, Type::Core, "core upgrade: unreadable installed core: {error:#}");
        std::string::String::new()
    });

    let (proxy, latest) = resolve_latest_version(alpha).await?;
    logging!(
        info,
        Type::Core,
        "core upgrade: {core} installed={installed:?} latest={latest:?} via {proxy:?}"
    );

    if !force && installed == latest {
        return Ok(CoreUpgradeReport {
            upgraded: false,
            from: installed,
            to: latest,
        });
    }

    let package = download_package(proxy, alpha, &latest).await?;
    let staged = stage_core(&target, &package, &latest)?;

    // A hard link keeps the previous core reachable without touching the inode the running
    // core executes from, so publishing below stays one atomic rename.
    let rollback = target.with_file_name(format!(".{core}.rollback"));
    let _ = std::fs::remove_file(&rollback);
    // Nothing to roll back to when the core we are replacing could not report a version.
    let restorable = !installed.is_empty() && std::fs::hard_link(&target, &rollback).is_ok();

    let mut result = staged.publish(&target);
    if result.is_ok() {
        result = CoreManager::global()
            .restart_core()
            .await
            .context("core replaced but failed to restart");
    }

    if let Err(error) = result {
        // Put the previous core back when its file is gone or its process is down. A failure
        // after the new core started must keep the new file instead.
        let core_is_down = matches!(*CoreManager::global().get_running_mode(), RunningMode::NotRunning);
        if restorable && (core_is_down || !target.exists()) && std::fs::rename(&rollback, &target).is_ok() {
            logging!(warn, Type::Core, "core upgrade: rolled back to {installed:?}");
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

    logging!(info, Type::Core, "core upgrade: {core} now at {latest}");
    Ok(CoreUpgradeReport {
        upgraded: true,
        from: installed,
        to: latest,
    })
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
async fn resolve_latest_version(alpha: bool) -> Result<(ProxyType, std::string::String)> {
    let url = if alpha {
        format!("{ALPHA_BASE_URL}/version.txt")
    } else {
        RELEASE_VERSION_URL.to_owned()
    };
    let mut last_error = None;

    for proxy in [ProxyType::Localhost, ProxyType::System, ProxyType::None] {
        let attempt = NetworkManager::new()
            .get_with_interrupt(&url, proxy, Some(VERSION_TIMEOUT_SECS), None, false)
            .await;

        match attempt {
            Ok(response) if response.status().is_success() => {
                // An error page answered with 200 must not become a version, nor reach the URL.
                let version = response.text_with_charset().trim().to_owned();
                if !is_usable_version(&version) {
                    last_error = Some(anyhow!("{url} returned an unusable version"));
                    continue;
                }
                return Ok((proxy, version));
            }
            Ok(response) => last_error = Some(anyhow!("{url} returned status {}", response.status())),
            Err(error) => last_error = Some(error.context(format!("{proxy:?} could not reach {url}"))),
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
        .get_bytes_with_interrupt(&url, proxy, Some(PACKAGE_TIMEOUT_SECS), MAX_PACKAGE_BYTES)
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
    for _ in 0..32 {
        let generation = STAGING_GENERATION.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            ".{}.{}.{generation}.tmp",
            core_name.to_string_lossy(),
            std::process::id()
        ));

        match File::options().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| format!("failed to create {}", path.display()));
            }
        }
    }

    bail!("failed to create a unique staging file in {}", directory.display())
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

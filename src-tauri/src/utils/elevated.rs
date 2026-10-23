//! Replacing a root-owned core through one elevated run.
//!
//! Distribution packages install the core beside the app in a root-owned directory such as
//! `/usr/bin`, which the desktop user cannot write. The app re-executes its own binary through
//! pkexec with `--replace-core`: that run stages the attested bytes beside the target, renames
//! them over it, and hands the same file to the Service installer.
//!
//! The privileged mode trusts nothing from its caller: the target must be one of the two core
//! names in the directory the binary was started from, and the source must match the digest the
//! caller attested. `rename` never touches the inode a running core executes from, and a copy
//! interrupted before it leaves the live path exactly as it was.

use anyhow::{Context as _, Result, bail};
use std::{
    ffi::{OsStr, OsString},
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    process::{Command, ExitCode, Output},
};

const MODE_FLAG: &str = "--replace-core";
const SOURCE_FLAG: &str = "--source";
const TARGET_FLAG: &str = "--target";
const SHA256_FLAG: &str = "--sha256";
const SERVICE_FLAG: &str = "--publish-service";
/// Printed once the live path holds the new bytes, so the caller can tell a refused Service copy
/// from a replacement that never happened.
const REPLACED_MARKER: &str = "CLASH_VERGE_CORE_REPLACED_V1=1";
const CORE_NAMES: [&str; 2] = ["verge-mihomo", "verge-mihomo-alpha"];

/// How far an elevated replacement got.
pub enum Outcome {
    /// The core was replaced; the Service copy was updated or not requested.
    Published,
    /// The core was replaced, but the Service refused the same bytes.
    ServiceFailed(anyhow::Error),
}

/// Replaces `target` with `staged`, asking for elevation once.
pub fn replace_root_owned_file(staged: &Path, target: &Path, publish_service: bool) -> Result<Outcome> {
    let executable = std::env::current_exe().context("failed to locate the current executable")?;
    let digest = clash_verge_service_ipc::management::sha256_file(staged)
        .with_context(|| format!("failed to hash {}", staged.display()))?;

    let mut arguments: Vec<OsString> = vec![
        MODE_FLAG.into(),
        SOURCE_FLAG.into(),
        staged.as_os_str().to_owned(),
        TARGET_FLAG.into(),
        target.as_os_str().to_owned(),
        SHA256_FLAG.into(),
        digest.into(),
    ];
    if publish_service {
        arguments.push(SERVICE_FLAG.into());
    }

    let output = run_elevated(&executable, &arguments)?;
    if output.status.success() {
        return Ok(Outcome::Published);
    }

    let error = failure(&executable, &output);
    let replaced = String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line == REPLACED_MARKER);
    if replaced && publish_service {
        return Ok(Outcome::ServiceFailed(error));
    }
    Err(error)
}

/// Handles the privileged mode before Tauri, the singleton check or any window exists.
pub fn run_if_requested() -> Option<ExitCode> {
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().as_deref() != Some(OsStr::new(MODE_FLAG)) {
        return None;
    }

    Some(match replace(arguments) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    })
}

fn replace(arguments: impl Iterator<Item = OsString>) -> Result<()> {
    let request = Request::parse(arguments)?;
    if !running_as_root() {
        bail!("{MODE_FLAG} must run as root");
    }

    let directory = request.target.parent().context("the target has no parent directory")?;
    let name = request.target.file_name().context("the target has no file name")?;
    if !CORE_NAMES.iter().any(|core| OsStr::new(core) == name) {
        bail!("refusing to replace {name:?}: not a core name");
    }

    let executable = std::env::current_exe().context("failed to locate the running executable")?;
    let own_directory = executable
        .parent()
        .context("the running executable has no parent directory")?;
    if std::fs::canonicalize(directory)? != std::fs::canonicalize(own_directory)? {
        bail!("refusing to replace a core outside {}", own_directory.display());
    }

    if clash_verge_service_ipc::management::sha256_file(&request.source)? != request.sha256 {
        bail!("{} does not match the attested sha256", request.source.display());
    }

    publish(&request.source, &request.target, &request.sha256)?;
    println!("{REPLACED_MARKER}");

    if request.publish_service {
        publish_service_core(own_directory, &request.target)?;
    }
    Ok(())
}

/// The staged bytes land under the installer's `.next` name and only the rename touches the live
/// path, so a core that is still executing keeps its inode and a failure leaves the target alone.
fn publish(source: &Path, target: &Path, digest: &str) -> Result<()> {
    use std::os::unix::fs::PermissionsExt as _;

    let next = target.with_extension(clash_verge_service_ipc::CORE_STAGING_EXTENSION);
    remove_stale_staging(&next)?;

    let mut input = File::open(source).with_context(|| format!("failed to open {}", source.display()))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&next)
        .with_context(|| format!("failed to create {}", next.display()))?;
    std::io::copy(&mut input, &mut output).with_context(|| format!("failed to stage {}", next.display()))?;
    output
        .set_permissions(std::fs::Permissions::from_mode(0o755))
        .with_context(|| format!("failed to permit {}", next.display()))?;
    output
        .sync_all()
        .with_context(|| format!("failed to flush {}", next.display()))?;
    drop(output);

    if clash_verge_service_ipc::management::sha256_file(&next)? != digest {
        let _ = std::fs::remove_file(&next);
        bail!("{} changed while it was copied", source.display());
    }

    std::fs::rename(&next, target).with_context(|| format!("failed to replace {}", target.display()))?;
    // The rename is only durable once its directory entry is flushed.
    if let Ok(directory) = File::open(target.parent().context("the target has no parent directory")?) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn remove_stale_staging(path: &Path) -> Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => std::fs::remove_file(path).with_context(|| format!("failed to remove stale {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

fn publish_service_core(directory: &Path, target: &Path) -> Result<()> {
    let name = target
        .file_name()
        .context("the target has no file name")?
        .to_string_lossy()
        .into_owned();
    let installer = directory.join(format!("clash-verge-service-install{}", std::env::consts::EXE_SUFFIX));
    // SAFETY: getgid has no preconditions and cannot fail.
    let gid = unsafe { libc::getgid() };

    // Already root, so the installer publishes without asking for elevation a second time.
    clash_verge_service_ipc::management::install(
        &installer,
        &[clash_verge_service_ipc::management::CoreSource {
            name,
            path: target.to_path_buf(),
        }],
        true,
        Some(gid),
        "Install the Clash Verge core",
    )
}

fn run_elevated(program: &Path, arguments: &[OsString]) -> Result<Output> {
    if running_as_root() {
        return Command::new(program)
            .args(arguments)
            .output()
            .context("failed to run the replacement");
    }

    let elevator = crate::utils::help::linux_elevator();
    let mut command = Command::new(&elevator);
    if elevator.contains("pkexec") {
        command.arg("--disable-internal-agent");
    }
    let output = command.arg(program).args(arguments).output()?;
    if output.status.success() {
        return Ok(output);
    }

    // pkexec has no agent to ask (exit 127) on minimal desktops; sudo covers that case. A failure
    // here still reports the pkexec attempt, which is the one the user acted on.
    if elevator.contains("pkexec")
        && let Ok(sudo) = Command::new("sudo").arg(program).args(arguments).output()
        && sudo.status.success()
    {
        return Ok(sudo);
    }

    Ok(output)
}

fn running_as_root() -> bool {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() == 0 }
}

fn failure(program: &Path, output: &Output) -> anyhow::Error {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        anyhow::anyhow!("{} failed with {}", program.display(), output.status)
    } else {
        anyhow::anyhow!("{} failed with {}: {stderr}", program.display(), output.status)
    }
}

struct Request {
    source: PathBuf,
    target: PathBuf,
    sha256: String,
    publish_service: bool,
}

impl Request {
    fn parse(mut arguments: impl Iterator<Item = OsString>) -> Result<Self> {
        let mut source = None;
        let mut target = None;
        let mut sha256 = None;
        let mut publish_service = false;

        while let Some(argument) = arguments.next() {
            match argument.to_str() {
                Some(SOURCE_FLAG) => source = Some(PathBuf::from(value(&mut arguments, SOURCE_FLAG)?)),
                Some(TARGET_FLAG) => target = Some(PathBuf::from(value(&mut arguments, TARGET_FLAG)?)),
                Some(SHA256_FLAG) => {
                    sha256 = Some(
                        value(&mut arguments, SHA256_FLAG)?
                            .into_string()
                            .map_err(|_| anyhow::anyhow!("{SHA256_FLAG} is not valid UTF-8"))?,
                    );
                }
                Some(SERVICE_FLAG) => publish_service = true,
                _ => bail!("unknown argument: {argument:?}"),
            }
        }

        Ok(Self {
            source: source.context(format!("{SOURCE_FLAG} is required"))?,
            target: target.context(format!("{TARGET_FLAG} is required"))?,
            sha256: sha256.context(format!("{SHA256_FLAG} is required"))?,
            publish_service,
        })
    }
}

fn value(arguments: &mut impl Iterator<Item = OsString>, flag: &str) -> Result<OsString> {
    arguments.next().with_context(|| format!("{flag} requires a value"))
}

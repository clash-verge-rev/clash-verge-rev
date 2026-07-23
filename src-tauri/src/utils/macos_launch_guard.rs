use std::{
    ffi::CStr,
    os::unix::ffi::OsStrExt as _,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchLocation {
    Allowed { bundle: PathBuf },
    Movable { bundle: PathBuf },
    Translocated,
    Rejected { reason: LaunchRejectionReason },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchRejectionReason {
    NotInApplicationBundle,
    CanonicalizeBundleFailed { error: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveDecision {
    SystemApplications,
    UserApplications,
    ConfirmReplacement,
    ManualInstructions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchDisposition {
    Continue,
    Exit,
}

pub fn evaluate_install_location(executable: &Path, home: &Path) -> LaunchLocation {
    evaluate_install_location_with_roots(executable, home, Path::new("/Applications"))
}

pub fn evaluate_install_location_with_roots(
    executable: &Path,
    home: &Path,
    system_applications: &Path,
) -> LaunchLocation {
    if executable
        .components()
        .any(|component| component.as_os_str() == "AppTranslocation")
    {
        return LaunchLocation::Translocated;
    }

    let Some(bundle) = executable.ancestors().find(|ancestor| {
        ancestor
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    }) else {
        return LaunchLocation::Rejected {
            reason: LaunchRejectionReason::NotInApplicationBundle,
        };
    };
    let canonical_bundle = match std::fs::canonicalize(bundle) {
        Ok(bundle) => bundle,
        Err(error) => {
            return LaunchLocation::Rejected {
                reason: LaunchRejectionReason::CanonicalizeBundleFailed {
                    error: error.to_string().into(),
                },
            };
        }
    };
    let system_root = canonical_allowed_root(system_applications);
    let user_root = canonical_allowed_root(&home.join("Applications"));
    let allowed = system_root
        .as_ref()
        .is_some_and(|root| canonical_bundle.starts_with(root))
        || user_root
            .as_ref()
            .is_some_and(|root| canonical_bundle.starts_with(root));

    if allowed {
        LaunchLocation::Allowed {
            bundle: canonical_bundle,
        }
    } else {
        LaunchLocation::Movable {
            bundle: canonical_bundle,
        }
    }
}

fn canonical_allowed_root(path: &Path) -> Option<PathBuf> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

fn current_user_home() -> anyhow::Result<PathBuf> {
    const DEFAULT_BUFFER_SIZE: usize = 16 * 1024;
    const MAX_BUFFER_SIZE: usize = 1024 * 1024;

    let uid = unsafe { libc::geteuid() };
    let configured_size = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let mut buffer_size = if configured_size > 0 {
        usize::try_from(configured_size).unwrap_or(DEFAULT_BUFFER_SIZE)
    } else {
        DEFAULT_BUFFER_SIZE
    }
    .max(1024);

    loop {
        if buffer_size > MAX_BUFFER_SIZE {
            anyhow::bail!("effective-user home lookup exceeded the maximum buffer size");
        }

        let mut passwd = std::mem::MaybeUninit::<libc::passwd>::zeroed();
        let mut result = std::ptr::null_mut();
        let mut buffer = vec![0_u8; buffer_size];
        let code = unsafe {
            libc::getpwuid_r(
                uid,
                passwd.as_mut_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                &mut result,
            )
        };
        if code == libc::ERANGE {
            buffer_size = buffer_size.saturating_mul(2);
            continue;
        }
        if code != 0 {
            return Err(std::io::Error::from_raw_os_error(code).into());
        }
        if result.is_null() {
            anyhow::bail!("effective user {uid} has no password database entry");
        }

        let passwd = unsafe { passwd.assume_init() };
        if passwd.pw_dir.is_null() {
            anyhow::bail!("effective user {uid} has no home directory");
        }
        let home = unsafe { CStr::from_ptr(passwd.pw_dir) };
        if home.to_bytes().is_empty() {
            anyhow::bail!("effective user {uid} has an empty home directory");
        }
        return Ok(PathBuf::from(std::ffi::OsStr::from_bytes(home.to_bytes())));
    }
}

pub const fn move_decision(
    translocated: bool,
    system_applications_writable: bool,
    target_exists: bool,
) -> MoveDecision {
    if translocated {
        MoveDecision::ManualInstructions
    } else if target_exists {
        MoveDecision::ConfirmReplacement
    } else if system_applications_writable {
        MoveDecision::SystemApplications
    } else {
        MoveDecision::UserApplications
    }
}

pub fn enforce_before_initialization() -> LaunchDisposition {
    clash_verge_i18n::sync_locale(None);

    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            let message = clash_verge_i18n::t!("launchGuard.currentExeError").replace("{error}", &error.to_string());
            show_message(&message);
            return LaunchDisposition::Exit;
        }
    };
    let home = match current_user_home() {
        Ok(home) => home,
        Err(error) => {
            let message = clash_verge_i18n::t!("launchGuard.homeDirError").replace("{error}", &error.to_string());
            show_message(&message);
            return LaunchDisposition::Exit;
        }
    };

    match evaluate_install_location(&executable, &home) {
        LaunchLocation::Allowed { .. } => LaunchDisposition::Continue,
        LaunchLocation::Translocated => {
            show_message(&clash_verge_i18n::t!("launchGuard.translocated"));
            LaunchDisposition::Exit
        }
        LaunchLocation::Rejected { reason } => {
            let reason = match reason {
                LaunchRejectionReason::NotInApplicationBundle => {
                    clash_verge_i18n::t!("launchGuard.notInBundle").into_owned()
                }
                LaunchRejectionReason::CanonicalizeBundleFailed { error } => {
                    clash_verge_i18n::t!("launchGuard.canonicalizeBundleError").replace("{error}", &error)
                }
            };
            let message = clash_verge_i18n::t!("launchGuard.rejected").replace("{reason}", &reason);
            show_message(&message);
            LaunchDisposition::Exit
        }
        LaunchLocation::Movable { bundle } => move_and_relaunch(&bundle, &home),
    }
}

fn move_and_relaunch(bundle: &Path, home: &Path) -> LaunchDisposition {
    let system_root = Path::new("/Applications");
    let system_writable = path_is_writable(system_root);
    let destination_root = if system_writable {
        system_root.to_path_buf()
    } else {
        home.join("Applications")
    };
    let Some(bundle_name) = bundle.file_name() else {
        show_message(&clash_verge_i18n::t!("launchGuard.bundleNameError"));
        return LaunchDisposition::Exit;
    };
    let destination = destination_root.join(bundle_name);
    let exists = destination.exists();
    let destination_display = destination.display().to_string();
    let prompt = if exists {
        clash_verge_i18n::t!("launchGuard.replacePrompt").replace("{destination}", &destination_display)
    } else {
        clash_verge_i18n::t!("launchGuard.movePrompt").replace("{destination}", &destination_display)
    };
    if !confirm(&prompt) {
        return LaunchDisposition::Exit;
    }
    if let Err(error) = std::fs::create_dir_all(&destination_root) {
        let message =
            clash_verge_i18n::t!("launchGuard.createApplicationsDirError").replace("{error}", &error.to_string());
        show_message(&message);
        return LaunchDisposition::Exit;
    }
    let staging = sibling_swap_path(&destination, "installing");
    let backup = sibling_swap_path(&destination, "backup");
    let _ = remove_existing_target(&staging);
    let _ = remove_existing_target(&backup);
    let copy = std::process::Command::new("/usr/bin/ditto")
        .arg(bundle)
        .arg(&staging)
        .status();
    if !copy.is_ok_and(|status| status.success()) {
        let _ = remove_existing_target(&staging);
        show_message(&clash_verge_i18n::t!("launchGuard.moveFailed"));
        return LaunchDisposition::Exit;
    }
    let backup = match activate_staged_bundle(&staging, &destination, &backup) {
        Ok(backup) => backup,
        Err(error) => {
            let _ = remove_existing_target(&staging);
            let message = clash_verge_i18n::t!("launchGuard.replaceFailed").replace("{error}", &error.to_string());
            show_message(&message);
            return LaunchDisposition::Exit;
        }
    };
    let relaunched = std::process::Command::new("/usr/bin/open")
        .args(["-n"])
        .arg(&destination)
        .status()
        .is_ok_and(|status| status.success());
    if !relaunched {
        if let Some(backup) = backup.as_ref() {
            let _ = remove_existing_target(&staging);
            if std::fs::rename(&destination, &staging).is_ok() {
                let _ = std::fs::rename(backup, &destination);
                let _ = remove_existing_target(&staging);
            }
        }
        show_message(&clash_verge_i18n::t!("launchGuard.relaunchFailed"));
        return LaunchDisposition::Exit;
    }
    if let Some(backup) = backup {
        let _ = remove_existing_target(&backup);
    }
    if bundle != destination {
        let _ = std::fs::remove_dir_all(bundle);
    }
    LaunchDisposition::Exit
}

fn sibling_swap_path(destination: &Path, label: &str) -> PathBuf {
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Clash Verge.app");
    destination.with_file_name(format!(".{name}.{label}-{}", std::process::id()))
}

fn activate_staged_bundle(staging: &Path, destination: &Path, backup: &Path) -> std::io::Result<Option<PathBuf>> {
    let staging_metadata = std::fs::symlink_metadata(staging)?;
    if staging_metadata.file_type().is_symlink() || !staging_metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "staged application is not an ordinary bundle directory",
        ));
    }

    let had_destination = std::fs::symlink_metadata(destination).is_ok();
    if had_destination {
        std::fs::rename(destination, backup)?;
    }
    if let Err(error) = std::fs::rename(staging, destination) {
        if had_destination {
            let _ = std::fs::rename(backup, destination);
        }
        return Err(error);
    }
    Ok(had_destination.then(|| backup.to_path_buf()))
}

fn remove_existing_target(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(path)
    } else {
        std::fs::remove_dir_all(path)
    }
}

fn path_is_writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt as _;

    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

fn confirm(message: &str) -> bool {
    let cancel_button = clash_verge_i18n::t!("launchGuard.cancel");
    let move_button = clash_verge_i18n::t!("launchGuard.move");
    let script = format!(
        "display dialog \"{}\" buttons {{\"{}\", \"{}\"}} default button \"{}\" with icon caution",
        escape_osascript(message),
        escape_osascript(cancel_button.as_ref()),
        escape_osascript(move_button.as_ref()),
        escape_osascript(move_button.as_ref())
    );
    let selected_button = format!("button returned:{move_button}");
    std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .is_ok_and(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).contains(&selected_button)
        })
}

fn show_message(message: &str) {
    let ok_button = clash_verge_i18n::t!("launchGuard.ok");
    let script = format!(
        "display dialog \"{}\" buttons {{\"{}\"}} default button \"{}\" with icon caution",
        escape_osascript(message),
        escape_osascript(ok_button.as_ref()),
        escape_osascript(ok_button.as_ref())
    );
    let _ = std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .status();
}

fn escape_osascript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

#[cfg(test)]
mod tests {
    use super::{
        LaunchLocation, MoveDecision, activate_staged_bundle, current_user_home, evaluate_install_location_with_roots,
        move_decision,
    };
    use std::{ffi::CStr, os::unix::ffi::OsStrExt as _};

    fn executable(bundle: &std::path::Path) -> anyhow::Result<std::path::PathBuf> {
        let executable = bundle.join("Contents/MacOS/clash-verge");
        let parent = executable
            .parent()
            .ok_or_else(|| anyhow::anyhow!("test executable has no parent"))?;
        std::fs::create_dir_all(parent)?;
        std::fs::write(&executable, b"app")?;
        Ok(executable)
    }

    #[test]
    fn canonical_allowed_roots_and_nested_bundles_are_accepted() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("launch-guard-{}", std::process::id()));
        let home = root.join("home");
        let system = root.join("Applications");
        let user = home.join("Applications");
        let system_exe = executable(&system.join("Tools/Clash Verge.app"))?;
        let user_exe = executable(&user.join("Network/Clash Verge.app"))?;

        assert!(matches!(
            evaluate_install_location_with_roots(&system_exe, &home, &system),
            LaunchLocation::Allowed { .. }
        ));
        assert!(matches!(
            evaluate_install_location_with_roots(&user_exe, &home, &system),
            LaunchLocation::Allowed { .. }
        ));
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn failed_staged_activation_preserves_existing_application() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!("launch-guard-swap-{}", std::process::id()));
        let destination = root.join("Clash Verge.app");
        let staging = root.join(".Clash Verge.app.installing");
        let backup = root.join(".Clash Verge.app.backup");
        std::fs::create_dir_all(&destination)?;
        std::fs::write(destination.join("old"), b"old")?;
        std::fs::create_dir_all(&staging)?;
        std::fs::write(staging.join("new"), b"new")?;
        std::fs::write(&backup, b"blocks rename")?;

        let Err(error) = activate_staged_bundle(&staging, &destination, &backup) else {
            anyhow::bail!("occupied backup path must fail without deleting destination");
        };

        assert_ne!(error.kind(), std::io::ErrorKind::NotFound);
        assert_eq!(std::fs::read(destination.join("old"))?, b"old");
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn canonicalization_accepts_symlink_in_and_rejects_symlink_escape() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("launch-guard-links-{}", std::process::id()));
        let home = root.join("home");
        let system = root.join("Applications");
        let downloads = home.join("Downloads");
        std::fs::create_dir_all(&downloads)?;
        let allowed_bundle = system.join("Clash Verge.app");
        let allowed_exe = executable(&allowed_bundle)?;
        let link_in = downloads.join("Clash Verge.app");
        symlink(&allowed_bundle, &link_in)?;
        let escaped_bundle = downloads.join("Escaped.app");
        executable(&escaped_bundle)?;
        std::fs::create_dir_all(&system)?;
        let link_out = system.join("Escaped.app");
        symlink(&escaped_bundle, &link_out)?;

        assert!(matches!(
            evaluate_install_location_with_roots(&link_in.join("Contents/MacOS/clash-verge"), &home, &system),
            LaunchLocation::Allowed { .. }
        ));
        assert!(matches!(
            evaluate_install_location_with_roots(&link_out.join("Contents/MacOS/clash-verge"), &home, &system),
            LaunchLocation::Movable { .. }
        ));
        assert!(allowed_exe.is_file());
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn allowed_root_symlink_escape_is_not_authorized() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("launch-guard-root-link-{}", std::process::id()));
        let home = root.join("home");
        let downloads = home.join("Downloads");
        let system = root.join("SystemApplications");
        std::fs::create_dir_all(&downloads)?;
        std::fs::create_dir_all(&system)?;
        symlink(&downloads, home.join("Applications"))?;
        let escaped_exe = executable(&home.join("Applications/Clash Verge.app"))?;

        assert!(matches!(
            evaluate_install_location_with_roots(&escaped_exe, &home, &system),
            LaunchLocation::Movable { .. }
        ));
        std::fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn current_home_matches_effective_user_database_entry() -> anyhow::Result<()> {
        let home = current_user_home()?;
        let passwd = unsafe { libc::getpwuid(libc::geteuid()) };
        if passwd.is_null() {
            anyhow::bail!("effective user has no password database entry");
        }
        let expected = unsafe { CStr::from_ptr((*passwd).pw_dir) };
        assert_eq!(home.as_os_str().as_bytes(), expected.to_bytes());
        Ok(())
    }

    #[test]
    fn translocation_and_missing_bundle_are_rejected_before_side_effects() {
        let translocated =
            std::path::Path::new("/private/var/folders/AppTranslocation/Clash Verge.app/Contents/MacOS/clash-verge");
        assert_eq!(
            evaluate_install_location_with_roots(
                translocated,
                std::path::Path::new("/Users/test"),
                std::path::Path::new("/Applications")
            ),
            LaunchLocation::Translocated
        );
        assert!(matches!(
            evaluate_install_location_with_roots(
                std::path::Path::new("/Users/test/Downloads/clash-verge"),
                std::path::Path::new("/Users/test"),
                std::path::Path::new("/Applications")
            ),
            LaunchLocation::Rejected { .. }
        ));
    }

    #[test]
    fn mover_decision_prefers_system_then_user_and_never_moves_translocation() {
        assert_eq!(move_decision(false, true, false), MoveDecision::SystemApplications);
        assert_eq!(move_decision(false, false, false), MoveDecision::UserApplications);
        assert_eq!(move_decision(true, true, false), MoveDecision::ManualInstructions);
        assert_eq!(move_decision(false, true, true), MoveDecision::ConfirmReplacement);
    }
}

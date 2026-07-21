use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchLocation {
    Allowed { bundle: PathBuf },
    Movable { bundle: PathBuf },
    Translocated,
    Rejected { reason: String },
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
            reason: "executable is not inside an application bundle".to_string(),
        };
    };
    let canonical_bundle = match std::fs::canonicalize(bundle) {
        Ok(bundle) => bundle,
        Err(error) => {
            return LaunchLocation::Rejected {
                reason: format!("failed to canonicalize application bundle: {error}"),
            };
        }
    };
    let system_root = std::fs::canonicalize(system_applications).ok();
    let user_root = std::fs::canonicalize(home.join("Applications")).ok();
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
    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(error) => {
            show_message(&format!("无法确定应用位置：{error}"));
            return LaunchDisposition::Exit;
        }
    };
    let home = match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home),
        None => {
            show_message("无法确定当前用户主目录，应用将退出。");
            return LaunchDisposition::Exit;
        }
    };

    match evaluate_install_location(&executable, &home) {
        LaunchLocation::Allowed { .. } => LaunchDisposition::Continue,
        LaunchLocation::Translocated => {
            show_message(
                "macOS 正在从 App Translocation 临时路径运行此应用。请在 Finder 中将应用手动拖到 /Applications 或 ~/Applications 后重新打开。",
            );
            LaunchDisposition::Exit
        }
        LaunchLocation::Rejected { reason } => {
            show_message(&format!("此应用必须从 Applications 目录启动。\n\n{reason}"));
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
        show_message("无法确定应用包名称，应用将退出。");
        return LaunchDisposition::Exit;
    };
    let destination = destination_root.join(bundle_name);
    let exists = destination.exists();
    let prompt = if exists {
        format!(
            "目标位置已存在 {}。是否替换并从 Applications 重新启动？",
            destination.display()
        )
    } else {
        format!(
            "为了安全启动后台服务，需要将应用移动到 {}。是否现在移动并重新启动？",
            destination.display()
        )
    };
    if !confirm(&prompt) {
        return LaunchDisposition::Exit;
    }
    if let Err(error) = std::fs::create_dir_all(&destination_root) {
        show_message(&format!("无法创建 Applications 目录：{error}"));
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
        show_message("移动应用失败。请在 Finder 中手动移动后重试。");
        return LaunchDisposition::Exit;
    }
    let backup = match activate_staged_bundle(&staging, &destination, &backup) {
        Ok(backup) => backup,
        Err(error) => {
            let _ = remove_existing_target(&staging);
            show_message(&format!("无法安全替换现有应用：{error}"));
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
        show_message("应用已复制，但自动重新启动失败。请从 Applications 手动打开。");
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
    let script = format!(
        "display dialog \"{}\" buttons {{\"取消\", \"移动\"}} default button \"移动\" with icon caution",
        escape_osascript(message)
    );
    std::process::Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .is_ok_and(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).contains("button returned:移动")
        })
}

fn show_message(message: &str) {
    let script = format!(
        "display dialog \"{}\" buttons {{\"好\"}} default button \"好\" with icon caution",
        escape_osascript(message)
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
        LaunchLocation, MoveDecision, activate_staged_bundle, evaluate_install_location_with_roots, move_decision,
    };

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

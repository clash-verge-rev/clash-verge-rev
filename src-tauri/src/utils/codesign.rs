use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use clash_verge_logging::{Type, logging};

use crate::config::Config;

enum SignatureType {
    Adhoc,
    DeveloperId,
    Unsigned,
}

fn get_signature_type(path: &str) -> SignatureType {
    use std::process::Command;

    let output = Command::new("codesign").args(["-dvv", path]).output();

    let Ok(output) = output else {
        return SignatureType::Unsigned;
    };

    let stderr = String::from_utf8_lossy(&output.stderr);

    if stderr.contains("Signature=adhoc") {
        SignatureType::Adhoc
    } else if stderr.contains("Authority=") {
        SignatureType::DeveloperId
    } else {
        SignatureType::Unsigned
    }
}

fn force_signature_to_adhoc(path: &str) -> Result<()> {
    use std::process::Command;

    let output = Command::new("codesign").args(["-s", "-", "-f", path]).output();

    let Ok(output) = output else {
        return Err(anyhow::anyhow!("Failed to force signature to adhoc"));
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        return Err(anyhow::anyhow!("Failed to force signature to adhoc: {}", stderr));
    }

    Ok(())
}

fn relative_command_path(command: &Path) -> Result<PathBuf> {
    let exe_path = tauri::utils::platform::current_exe()?;

    let exe_dir = exe_path.parent().context("current exe has no parent")?;

    // If a test is being run, the executable is in the "deps" directory, so we need to go up one level.
    let base_dir = if exe_dir.ends_with("deps") {
        exe_dir.parent().context("exe dir is deps but has no parent")?
    } else {
        exe_dir
    };

    let mut command_path = base_dir.join(command);

    #[cfg(windows)]
    {
        let already_exe = command_path.extension().is_some_and(|ext| ext == "exe");
        if !already_exe {
            // do not use with_extension to retain dots in the command filename
            command_path.as_mut_os_string().push(".exe");
        }
    }

    #[cfg(not(windows))]
    {
        if command_path.extension().is_some_and(|ext| ext == "exe") {
            command_path.set_extension("");
        }
    }

    Ok(command_path)
}

pub async fn force_sign_core_adhoc() -> Result<()> {
    use crate::utils::dirs::path_to_str;

    if !Config::verge()
        .await
        .latest_arc()
        .force_signature_to_adhoc
        .unwrap_or_default()
    {
        return Ok(());
    }

    logging!(info, Type::Setup, "checking core signature...");
    let core_path = relative_command_path(Path::new("verge-mihomo"))?;
    let alpha_core_path = relative_command_path(Path::new("verge-mihomo-alpha"))?;
    let core_path_str = path_to_str(&core_path)?;
    let alpha_core_path_str = path_to_str(&alpha_core_path)?;
    if !matches!(get_signature_type(core_path_str), SignatureType::Adhoc) {
        logging!(
            warn,
            Type::Setup,
            "core[verge-mihomo] signature is not adhoc, forcing to adhoc"
        );
        force_signature_to_adhoc(core_path_str)?;
    }
    if !matches!(get_signature_type(alpha_core_path_str), SignatureType::Adhoc) {
        logging!(
            warn,
            Type::Setup,
            "alpha core[verge-mihomo-alpha] signature is not adhoc, forcing to adhoc"
        );
        force_signature_to_adhoc(alpha_core_path_str)?;
    }

    logging!(info, Type::Setup, "core signature check finished");

    Ok(())
}

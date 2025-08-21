use crate::config::{Config, IClashConfig, IProfiles, IVerge};
use crate::core::handle;
use crate::error::AppError;
use crate::error::AppResult;
use crate::utils::{dirs, help};
use crate::{any_err, trace_err};
use std::path::PathBuf;
use tauri_plugin_shell::ShellExt;

/// Initialize all the config files
/// before tauri setup
pub fn init_dirs_and_config() -> AppResult<()> {
    // init dirs
    dirs::app_home_dir().and_then(|app_dir| {
        if !app_dir.exists() {
            std::fs::create_dir_all(&app_dir)?;
        }
        Ok(())
    })?;

    dirs::app_profiles_dir().and_then(|profiles_dir| {
        if !profiles_dir.exists() {
            std::fs::create_dir_all(&profiles_dir)?;
        }
        Ok(())
    })?;

    dirs::app_logs_dir().and_then(|logs_dir| {
        if !logs_dir.exists() {
            std::fs::create_dir_all(&logs_dir)?;
        }
        Ok(())
    })?;

    dirs::app_service_logs_dir().and_then(|service_logs_dir| {
        if !service_logs_dir.exists() {
            std::fs::create_dir_all(&service_logs_dir)?;
        }
        Ok(())
    })?;

    dirs::backup_dir().and_then(|backup_dir| {
        if !backup_dir.exists() {
            std::fs::create_dir_all(&backup_dir)?;
        }
        Ok(())
    })?;

    // init yaml config
    dirs::clash_path().and_then(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IClashConfig::default().0, Some("# Clash Verge"))?;
        }
        Ok(())
    })?;

    dirs::verge_path().and_then(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IVerge::template(), Some("# Clash Verge"))?;
        }
        Ok(())
    })?;

    dirs::profiles_path().and_then(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IProfiles::template(), Some("# Clash Verge"))?;
        }
        Ok(())
    })?;

    Ok(())
}

/// initialize app resources
/// after tauri setup
pub fn init_resources() -> AppResult<()> {
    let app_dir = dirs::app_home_dir().and_then(|app_dir| {
        if !app_dir.exists() {
            std::fs::create_dir_all(&app_dir)?;
        }
        Ok(app_dir)
    })?;
    let res_dir = dirs::app_resources_dir().and_then(|res_dir| {
        if !res_dir.exists() {
            std::fs::create_dir_all(&res_dir)?;
        }
        Ok(res_dir)
    })?;

    // copy the resource file
    // if the source file is newer than the destination file, copy it over
    let file_list = ["Country.mmdb", "geoip.dat", "geosite.dat", "ASN.mmdb"];
    let handle_copy = |src_path: &PathBuf, dest_path: &PathBuf, file: &str| {
        match std::fs::copy(src_path, dest_path) {
            Ok(_) => tracing::debug!("resources copied '{file}'"),
            Err(err) => {
                tracing::error!("failed to copy resources '{file}', {err}")
            }
        };
    };
    for file in file_list.iter() {
        let src_path = res_dir.join(file);
        let dest_path = app_dir.join(file);

        if src_path.exists() && !dest_path.exists() {
            handle_copy(&src_path, &dest_path, file);
            continue;
        }

        let src_modified = std::fs::metadata(&src_path).and_then(|m| m.modified());
        let dest_modified = std::fs::metadata(&dest_path).and_then(|m| m.modified());
        match (src_modified, dest_modified) {
            (Ok(src_modified), Ok(dest_modified)) => {
                if src_modified > dest_modified {
                    handle_copy(&src_path, &dest_path, file);
                } else {
                    tracing::debug!("skipping resource copy '{file}'");
                }
            }
            _ => {
                tracing::debug!("failed to get modified '{file}'");
                handle_copy(&src_path, &dest_path, file);
            }
        };
    }

    Ok(())
}

/// initialize url scheme
#[cfg(target_os = "windows")]
pub fn init_scheme() -> AppResult<()> {
    use tauri::utils::platform::current_exe;
    use winreg::RegKey;
    use winreg::enums::*;

    let app_exe = current_exe()?;
    let app_exe = dunce::canonicalize(app_exe)?;
    let app_exe = app_exe.to_string_lossy().into_owned();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (clash, _) = hkcu.create_subkey("Software\\Classes\\Clash")?;
    clash.set_value("", &"Clash Verge")?;
    clash.set_value("URL Protocol", &"Clash Verge URL Scheme Protocol")?;
    let (default_icon, _) = hkcu.create_subkey("Software\\Classes\\Clash\\DefaultIcon")?;
    default_icon.set_value("", &app_exe)?;
    let (command, _) = hkcu.create_subkey("Software\\Classes\\Clash\\Shell\\Open\\Command")?;
    command.set_value("", &format!("{app_exe} \"%1\""))?;

    Ok(())
}
#[cfg(target_os = "linux")]
pub fn init_scheme() -> AppResult<()> {
    let output = std::process::Command::new("xdg-mime")
        .arg("default")
        .arg("clash-verge.desktop")
        .arg("x-scheme-handler/clash")
        .output()?;
    if !output.status.success() {
        use crate::{any_err, error::AppError};

        return Err(any_err!(
            "failed to set clash scheme, {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}
#[cfg(target_os = "macos")]
pub fn init_scheme() -> AppResult<()> {
    Ok(())
}

pub async fn startup_script() -> AppResult<()> {
    let verge = Config::verge();
    let verge = verge.latest();
    let path = verge.startup_script.as_deref().unwrap_or_default();

    if !path.is_empty() {
        let mut shell = "";
        if path.ends_with(".sh") {
            shell = "bash";
        }
        if path.ends_with(".ps1") {
            shell = "powershell";
        }
        if path.ends_with(".bat") {
            shell = "powershell";
        }
        if shell.is_empty() {
            return Err(any_err!("unsupported script: {path}"));
        }
        let current_dir = PathBuf::from(path);
        if !current_dir.exists() {
            return Err(any_err!("script not found: {path}"));
        }
        let current_dir = current_dir.parent();
        let app_handle = handle::Handle::app_handle();
        let mut cmd = app_handle.shell().command(shell);
        if let Some(dir) = current_dir {
            cmd = cmd.current_dir(dir);
        }
        trace_err!(cmd.args([path]).output().await, "run startup script failed");
    }
    Ok(())
}

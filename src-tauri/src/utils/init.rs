use crate::config::*;
use crate::core::handle;
use crate::core::verge_log::VergeLog;
use crate::utils::{dirs, help};
use anyhow::Result;
use std::fs::{self};
use std::path::PathBuf;
use tauri_plugin_shell::ShellExt;

/// Initialize all the config files
/// before tauri setup
pub fn init_config() -> Result<()> {
    dirs::init_portable_flag()?;
    VergeLog::global().init()?;
    VergeLog::delete_log()?;

    crate::log_err!(dirs::app_home_dir().map(|app_dir| {
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
    }));

    crate::log_err!(dirs::app_profiles_dir().map(|profiles_dir| {
        if !profiles_dir.exists() {
            let _ = fs::create_dir_all(&profiles_dir);
        }
    }));

    crate::log_err!(dirs::clash_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IClashConfig::default().0, Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    crate::log_err!(dirs::verge_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IVerge::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    crate::log_err!(dirs::profiles_path().map(|path| {
        if !path.exists() {
            help::save_yaml(&path, &IProfiles::template(), Some("# Clash Verge"))?;
        }
        <Result<()>>::Ok(())
    }));

    Ok(())
}

/// initialize app resources
/// after tauri setup
pub fn init_resources() -> Result<()> {
    let app_dir = dirs::app_home_dir()?;
    let res_dir = dirs::app_resources_dir()?;
    let backup_dir = dirs::backup_dir()?;

    if !app_dir.exists() {
        let _ = fs::create_dir_all(&app_dir);
    }
    if !res_dir.exists() {
        let _ = fs::create_dir_all(&res_dir);
    }

    if !backup_dir.exists() {
        let _ = fs::create_dir_all(&backup_dir);
    }

    let file_list = ["Country.mmdb", "geoip.dat", "geosite.dat", "ASN.mmdb"];

    // copy the resource file
    // if the source file is newer than the destination file, copy it over
    for file in file_list.iter() {
        let src_path = res_dir.join(file);
        let dest_path = app_dir.join(file);

        let handle_copy = || {
            match fs::copy(&src_path, &dest_path) {
                Ok(_) => log::debug!(target: "app", "resources copied '{file}'"),
                Err(err) => {
                    log::error!(target: "app", "failed to copy resources '{file}', {err}")
                }
            };
        };

        if src_path.exists() && !dest_path.exists() {
            handle_copy();
            continue;
        }

        let src_modified = fs::metadata(&src_path).and_then(|m| m.modified());
        let dest_modified = fs::metadata(&dest_path).and_then(|m| m.modified());

        match (src_modified, dest_modified) {
            (Ok(src_modified), Ok(dest_modified)) => {
                if src_modified > dest_modified {
                    handle_copy();
                } else {
                    log::debug!(target: "app", "skipping resource copy '{file}'");
                }
            }
            _ => {
                log::debug!(target: "app", "failed to get modified '{file}'");
                handle_copy();
            }
        };
    }

    Ok(())
}

/// initialize url scheme
#[cfg(target_os = "windows")]
pub fn init_scheme() -> Result<()> {
    use tauri::utils::platform::current_exe;
    use winreg::enums::*;
    use winreg::RegKey;

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
pub fn init_scheme() -> Result<()> {
    let output = std::process::Command::new("xdg-mime")
        .arg("default")
        .arg("clash-verge.desktop")
        .arg("x-scheme-handler/clash")
        .output()?;
    if !output.status.success() {
        return Err(anyhow::anyhow!(
            "failed to set clash scheme, {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}
#[cfg(target_os = "macos")]
pub fn init_scheme() -> Result<()> {
    Ok(())
}

pub async fn startup_script() -> Result<()> {
    let path = {
        let verge = Config::verge();
        let verge = verge.latest();
        verge.startup_script.clone().unwrap_or("".to_string())
    };

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
            return Err(anyhow::anyhow!("unsupported script: {path}"));
        }
        let current_dir = PathBuf::from(path.clone());
        if !current_dir.exists() {
            return Err(anyhow::anyhow!("script not found: {path}"));
        }
        let current_dir = current_dir.parent();
        let app_handle = handle::Handle::global().get_app_handle()?;
        match current_dir {
            Some(dir) => {
                let _ = app_handle
                    .shell()
                    .command(shell)
                    .current_dir(dir.to_path_buf())
                    .args([path])
                    .output()
                    .await;
            }
            None => {
                let _ = app_handle
                    .shell()
                    .command(shell)
                    .args([path])
                    .output()
                    .await;
            }
        }
    }
    Ok(())
}

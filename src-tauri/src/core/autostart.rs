#[cfg(target_os = "windows")]
use crate::utils::schtasks;
use crate::{config::Config, core::handle::Handle};
use anyhow::Result;
#[cfg(not(target_os = "windows"))]
use clash_verge_logging::logging_error;
use clash_verge_logging::{Type, logging};
#[cfg(target_os = "macos")]
use std::process::Command as MacCommand;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(target_os = "windows")]
use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;

/// Auto-start entries registered by releases predating the current
/// LaunchAgent naming (`~/Library/LaunchAgents/{bundle identifier}.plist`):
/// an AppleScript login item named after the executable (until Nov 2024)
/// and `clash-verge.plist` (until May 2025).
/// They are not controlled by the current auto-launch toggle and must be
/// removed explicitly.
#[cfg(target_os = "macos")]
const LEGACY_LOGIN_ITEMS: [&str; 1] = ["Clash Verge"];
#[cfg(target_os = "macos")]
const LEGACY_PLISTS: [&str; 1] = ["clash-verge.plist"];

#[cfg(target_os = "macos")]
pub fn cleanup_legacy_autostart() {
    if let Some(dir) = dirs::home_dir().map(|home| home.join("Library").join("LaunchAgents")) {
        for plist in LEGACY_PLISTS {
            let path = dir.join(plist);
            if path.exists()
                && let Err(err) = std::fs::remove_file(&path)
            {
                logging!(
                    warn,
                    Type::Setup,
                    "Failed to remove legacy auto-launch plist {}: {err}",
                    path.display()
                );
            }
        }
    }

    // Deleting a login item requires automation consent for "System Events";
    // a failed lookup means the entry cannot be managed here, so skip it.
    let Ok(output) = MacCommand::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get the name of every login item",
        ])
        .output()
    else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for item in LEGACY_LOGIN_ITEMS {
        if stdout.split(',').any(|name| name.trim() == item) {
            let script = format!("tell application \"System Events\" to delete login item \"{item}\"");
            if let Err(err) = MacCommand::new("osascript").args(["-e", &script]).output() {
                logging!(warn, Type::Setup, "Failed to remove legacy login item {item}: {err}");
            }
        }
    }
}

pub async fn update_launch() -> Result<()> {
    let enable_auto_launch = { Config::verge().await.latest_arc().enable_auto_launch };
    let is_enable = enable_auto_launch.unwrap_or(false);
    logging!(info, Type::System, "Setting auto-launch enabled state to: {is_enable}");

    #[cfg(target_os = "windows")]
    {
        let is_admin = is_current_app_handle_admin(Handle::app_handle());
        schtasks::set_auto_launch(is_enable, is_admin).await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        cleanup_legacy_autostart();
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();
        if is_enable {
            logging_error!(Type::System, "{:?}", autostart_manager.enable());
        } else {
            logging_error!(Type::System, "{:?}", autostart_manager.disable());
        }
    }

    Ok(())
}

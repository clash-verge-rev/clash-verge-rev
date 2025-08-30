#[cfg(target_os = "macos")]
pub async fn set_public_dns(dns_server: String) {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt;
    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            log::error!(target: "app", "app_handle not available for DNS configuration");
            return;
        }
    };

    log::info!(target: "app", "try to set system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!(target: "app", "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "set_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "set system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "set system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "set system dns failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt;
    let app_handle = match handle::Handle::global().app_handle() {
        Some(handle) => handle,
        None => {
            log::error!(target: "app", "app_handle not available for DNS restoration");
            return;
        }
    };
    log::info!(target: "app", "try to unset system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!(target: "app", "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        log::error!(target: "app", "unset_dns.sh not found");
        return;
    }
    let script = script.to_string_lossy().into_owned();
    match app_handle
        .shell()
        .command("bash")
        .args([script])
        .current_dir(resource_dir)
        .status()
        .await
    {
        Ok(status) => {
            if status.success() {
                log::info!(target: "app", "unset system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                log::error!(target: "app", "unset system dns failed: {code}");
            }
        }
        Err(err) => {
            log::error!(target: "app", "unset system dns failed: {err}");
        }
    }
}

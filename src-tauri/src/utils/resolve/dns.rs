use clash_verge_logging::{Type, logging};

pub async fn set_public_dns(dns_server: String) {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();

    logging!(info, Type::Config, "try to set system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("set_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "set_dns.sh not found");
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
                logging!(info, Type::Config, "set system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "set system dns failed: {code}");
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "set system dns failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn restore_public_dns() {
    use crate::{core::handle, utils::dirs};
    use tauri_plugin_shell::ShellExt as _;
    let app_handle = handle::Handle::app_handle();
    logging!(info, Type::Config, "try to unset system dns");
    let resource_dir = match dirs::app_resources_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get resource directory: {}", e);
            return;
        }
    };
    let script = resource_dir.join("unset_dns.sh");
    if !script.exists() {
        logging!(error, Type::Config, "unset_dns.sh not found");
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
                logging!(info, Type::Config, "unset system dns successfully");
            } else {
                let code = status.code().unwrap_or(-1);
                logging!(error, Type::Config, "unset system dns failed: {code}");
            }
        }
        Err(err) => {
            logging!(error, Type::Config, "unset system dns failed: {err}");
        }
    }
}

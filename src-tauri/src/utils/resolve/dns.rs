use clash_verge_logging::{Type, logging};
use std::path::{Path, PathBuf};

const DNS_STATE_FILE: &str = ".original_dns.txt";

fn dns_state_dir() -> anyhow::Result<PathBuf> {
    // The DNS scripts persist .original_dns.txt relative to their working directory.
    let dir = crate::utils::dirs::app_home_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn restore_dns_state_dir(resource_dir: &Path, state_dir: PathBuf) -> PathBuf {
    if resource_dir.join(DNS_STATE_FILE).exists() {
        resource_dir.to_path_buf()
    } else {
        state_dir
    }
}

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
    let state_dir = match dns_state_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get DNS state directory: {}", e);
            return;
        }
    };
    match app_handle
        .shell()
        .command("bash")
        .args([script, dns_server])
        .current_dir(state_dir)
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
    let state_dir = match dns_state_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logging!(error, Type::Config, "Failed to get DNS state directory: {}", e);
            return;
        }
    };
    let state_dir = restore_dns_state_dir(&resource_dir, state_dir);
    match app_handle
        .shell()
        .command("bash")
        .args([script])
        .current_dir(state_dir)
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

#[cfg(test)]
mod tests {
    use super::restore_dns_state_dir;

    #[test]
    #[allow(clippy::expect_used)]
    fn restore_dns_state_dir_defaults_to_app_data_but_honors_legacy_file() {
        let root = std::env::temp_dir().join(format!("clash-verge-dns-{}", nanoid::nanoid!()));
        let resource_dir = root.join("resources");
        let state_dir = root.join("app-data");
        std::fs::create_dir_all(&resource_dir).expect("create test resource directory");

        assert_eq!(restore_dns_state_dir(&resource_dir, state_dir.clone()), state_dir);

        std::fs::write(resource_dir.join(".original_dns.txt"), "empty").expect("create legacy DNS state");
        assert_eq!(restore_dns_state_dir(&resource_dir, state_dir), resource_dir);

        std::fs::remove_dir_all(root).expect("remove test directory");
    }
}

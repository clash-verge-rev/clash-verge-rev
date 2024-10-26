use serde_yaml::{Mapping, Value};

macro_rules! revise {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
    };
}

// if key not exists then append value
#[allow(unused_macros)]
macro_rules! append {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        if !$map.contains_key(&ret_key) {
            $map.insert(ret_key, Value::from($val));
        }
    };
}

pub async fn use_tun(mut config: Mapping, enable: bool) -> Mapping {
    let tun_key = Value::from("tun");
    let tun_val = config.get(&tun_key);
    let mut tun_val = tun_val.map_or(Mapping::new(), |val| {
        val.as_mapping().cloned().unwrap_or(Mapping::new())
    });
    let dns_key = Value::from("dns");
    let dns_val = config.get(&dns_key);
    let mut dns_val = dns_val.map_or(Mapping::new(), |val| {
        val.as_mapping().cloned().unwrap_or(Mapping::new())
    });

    if enable {
        revise!(dns_val, "enable", true);
        revise!(dns_val, "ip-v6", true);
        revise!(dns_val, "enhanced-mode", "fake-ip");
        revise!(dns_val, "fake-ip-range", "10.96.0.0/16");
        #[cfg(target_os = "macos")]
        set_public_dns("10.96.0.2".to_string()).await;
    } else {
        revise!(dns_val, "enhanced-mode", "redir-host");
        #[cfg(target_os = "macos")]
        restore_public_dns().await;
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);
    revise!(config, "dns", dns_val);
    config
}

#[cfg(target_os = "macos")]
async fn set_public_dns(dns_server: String) {
    use crate::core::handle;
    use crate::utils::dirs;
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();

    log::info!(target: "app", "try to set system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
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
async fn restore_public_dns() {
    use crate::core::handle;
    use crate::utils::dirs;
    use tauri_plugin_shell::ShellExt;
    let app_handle = handle::Handle::global().app_handle().unwrap();
    log::info!(target: "app", "try to unset system dns");
    let resource_dir = dirs::app_resources_dir().unwrap();
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

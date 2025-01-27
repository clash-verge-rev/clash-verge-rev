use serde_yaml::{Mapping, Value};

macro_rules! revise {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
    };
}

// if key not exists then append value
macro_rules! append {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        if !$map.contains_key(&ret_key) {
            $map.insert(ret_key, Value::from($val));
        }
    };
}

pub fn use_tun(mut config: Mapping, enable: bool) -> Mapping {
    let tun_key = Value::from("tun");
    let tun_val = config.get(&tun_key);

    if !enable && tun_val.is_none() {
        return config;
    }

    let mut tun_val = tun_val.map_or(Mapping::new(), |val| {
        val.as_mapping().cloned().unwrap_or(Mapping::new())
    });

    revise!(tun_val, "enable", enable);

    revise!(config, "tun", tun_val);

    if enable {
        #[cfg(target_os = "macos")]
        {
            use crate::utils::dirs;
            use std::process::Command;

            log::info!(target: "app", "try to set system dns");
            let resource_dir = dirs::app_resources_dir().unwrap();
            let script = resource_dir.join("set_dns.sh");
            match Command::new("bash")
                .args([script])
                .current_dir(resource_dir)
                .status()
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
        use_dns_for_tun(config)
    } else {
        #[cfg(target_os = "macos")]
        {
            use crate::utils::dirs;
            use std::process::Command;

            log::info!(target: "app", "try to unset system dns");
            let resource_dir = dirs::app_resources_dir().unwrap();
            let script = resource_dir.join("unset_dns.sh");
            match Command::new("bash")
                .args([script])
                .current_dir(resource_dir)
                .status()
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
        config
    }
}

fn use_dns_for_tun(mut config: Mapping) -> Mapping {
    let dns_key = Value::from("dns");
    let dns_val = config.get(&dns_key);

    let mut dns_val = dns_val.map_or(Mapping::new(), |val| {
        val.as_mapping().cloned().unwrap_or(Mapping::new())
    });

    // 开启tun将同时开启dns
    revise!(dns_val, "enable", true);

    append!(dns_val, "enhanced-mode", "fake-ip");
    append!(dns_val, "fake-ip-range", "198.18.0.1/16");
    append!(
        dns_val,
        "nameserver",
        vec!["114.114.114.114", "223.5.5.5", "8.8.8.8"]
    );
    append!(dns_val, "fallback", vec![] as Vec<&str>);

    #[cfg(target_os = "windows")]
    append!(
        dns_val,
        "fake-ip-filter",
        vec![
            "dns.msftncsi.com",
            "www.msftncsi.com",
            "www.msftconnecttest.com"
        ]
    );
    revise!(config, "dns", dns_val);
    config
}

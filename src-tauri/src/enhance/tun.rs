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
        revise!(dns_val, "ipv6", true);
        revise!(dns_val, "enhanced-mode", "fake-ip");
        revise!(dns_val, "fake-ip-range", "10.96.0.0/16");
        #[cfg(target_os = "macos")]
        {
            crate::utils::resolve::restore_public_dns().await;
            crate::utils::resolve::set_public_dns("10.96.0.2".to_string()).await;
        }
    } else {
        revise!(dns_val, "enhanced-mode", "redir-host");
        #[cfg(target_os = "macos")]
        crate::utils::resolve::restore_public_dns().await;
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);
    revise!(config, "dns", dns_val);
    config
}

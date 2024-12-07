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
    let ipv6_key = Value::from("ipv6");
    let ipv6_val = config
        .get(&ipv6_key)
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if enable {
        revise!(dns_val, "enable", true);
        revise!(dns_val, "ipv6", ipv6_val);
        revise!(dns_val, "enhanced-mode", "fake-ip");
        revise!(dns_val, "fake-ip-range", "172.29.0.1/16");
        #[cfg(target_os = "macos")]
        {
            crate::utils::resolve::restore_public_dns().await;
            crate::utils::resolve::set_public_dns("223.6.6.6".to_string()).await;
        }
    } else {
        revise!(
            dns_val,
            "enable",
            dns_val
                .get("enable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        );

        revise!(dns_val, "ipv6", ipv6_val);

        revise!(
            dns_val,
            "enhanced-mode",
            dns_val
                .get("enhanced-mode")
                .and_then(|v| v.as_str())
                .unwrap_or("redir-host")
        );

        revise!(
            dns_val,
            "fake-ip-range",
            dns_val
                .get("fake-ip-range")
                .and_then(|v| v.as_str())
                .unwrap_or("172.29.0.1/16")
        );

        #[cfg(target_os = "macos")]
        crate::utils::resolve::restore_public_dns().await;
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);
    revise!(config, "dns", dns_val);
    config
}

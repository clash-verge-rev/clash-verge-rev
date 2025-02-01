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
        // 检查现有的 enhanced-mode 设置
        let current_mode = dns_val
            .get(&Value::from("enhanced-mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("fake-ip");

        // 只有当 enhanced-mode 是 fake-ip 或未设置时才修改 DNS 配置
        if current_mode == "fake-ip" || !dns_val.contains_key(&Value::from("enhanced-mode")) {
            revise!(dns_val, "enable", true);
            revise!(dns_val, "ipv6", ipv6_val);
            
            if !dns_val.contains_key(&Value::from("enhanced-mode")) {
                revise!(dns_val, "enhanced-mode", "fake-ip");
            }
            
            if !dns_val.contains_key(&Value::from("fake-ip-range")) {
                revise!(dns_val, "fake-ip-range", "198.18.0.1/16");
            }

            #[cfg(target_os = "macos")]
            {
                crate::utils::resolve::restore_public_dns().await;
                crate::utils::resolve::set_public_dns("223.6.6.6".to_string()).await;
            }
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
                .unwrap_or("198.18.0.1/16")
        );

        #[cfg(target_os = "macos")]
        crate::utils::resolve::restore_public_dns().await;
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);
    revise!(config, "dns", dns_val);
    config
}

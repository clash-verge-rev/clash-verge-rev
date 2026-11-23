use serde_yaml_ng::{Mapping, Value};

macro_rules! revise {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
    };
}

pub fn use_tun(mut config: Mapping, enable: bool) -> Mapping {
    let mut tun_val = super::take_mapping(&mut config, "tun");

    if enable {
        let mut dns_val = super::take_mapping(&mut config, "dns");
        let ipv6_key = Value::from("ipv6");
        let ipv6_val = config.get(&ipv6_key).and_then(|v| v.as_bool()).unwrap_or(false);

        let current_mode = dns_val
            .get(Value::from("enhanced-mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("fake-ip");

        if current_mode == "fake-ip" {
            revise!(dns_val, "enable", true);
            revise!(dns_val, "ipv6", ipv6_val);

            if !dns_val.contains_key(Value::from("enhanced-mode")) {
                revise!(dns_val, "enhanced-mode", "fake-ip");
            }

            if !dns_val.contains_key(Value::from("fake-ip-range")) {
                revise!(dns_val, "fake-ip-range", "198.18.0.1/16");
            }

            if ipv6_val && !dns_val.contains_key(Value::from("fake-ip-range6")) {
                revise!(dns_val, "fake-ip-range6", "2001:2::0/64");
            }
        }

        revise!(config, "dns", dns_val);
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);

    config
}

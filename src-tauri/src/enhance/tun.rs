use serde_yaml_ng::{Mapping, Value};

macro_rules! revise {
    ($map: expr, $key: expr, $val: expr) => {
        let ret_key = Value::String($key.into());
        $map.insert(ret_key, Value::from($val));
    };
}

pub fn use_tun(mut config: Mapping, enable: bool) -> Mapping {
    let tun_key = Value::from("tun");
    let tun_val = config.get(&tun_key);
    let mut tun_val = tun_val.map_or_else(Mapping::new, |val| {
        val.as_mapping().cloned().unwrap_or_else(Mapping::new)
    });

    if enable {
        // 读取DNS配置
        let dns_key = Value::from("dns");
        let dns_val = config.get(&dns_key);
        let mut dns_val = dns_val.map_or_else(Mapping::new, |val| {
            val.as_mapping().cloned().unwrap_or_else(Mapping::new)
        });
        let ipv6_key = Value::from("ipv6");
        let ipv6_val = config.get(&ipv6_key).and_then(|v| v.as_bool()).unwrap_or(false);

        // 检查现有的 enhanced-mode 设置
        let current_mode = dns_val
            .get(Value::from("enhanced-mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("fake-ip");

        // 只有当 enhanced-mode 是 fake-ip 或未设置时才修改 DNS 配置
        if current_mode == "fake-ip" || !dns_val.contains_key(Value::from("enhanced-mode")) {
            revise!(dns_val, "enable", true);
            revise!(dns_val, "ipv6", ipv6_val);

            if !dns_val.contains_key(Value::from("enhanced-mode")) {
                revise!(dns_val, "enhanced-mode", "fake-ip");
            }

            if !dns_val.contains_key(Value::from("fake-ip-range")) {
                revise!(dns_val, "fake-ip-range", "198.18.0.1/16");
            }

            // 当启用 IPv6 时，补充 IPv6 的 fake-ip 范围
            if ipv6_val && !dns_val.contains_key(Value::from("fake-ip-range6")) {
                revise!(dns_val, "fake-ip-range6", "fdfe:dcba:9876::1/64");
            }
        }

        // 当TUN启用时，将修改后的DNS配置写回
        revise!(config, "dns", dns_val);
    }

    // 更新TUN配置
    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);

    config
}

#[cfg(any(target_os = "macos", test))]
fn should_override_system_dns(config: &Mapping) -> bool {
    let tun_enabled = config
        .get("tun")
        .and_then(|tun| tun.get("enable"))
        .and_then(Value::as_bool)
        == Some(true);
    let Some(dns) = config.get("dns") else {
        return false;
    };

    tun_enabled
        && dns.get("enable").and_then(Value::as_bool) == Some(true)
        && dns.get("enhanced-mode").and_then(Value::as_str) == Some("fake-ip")
}

#[cfg(target_os = "macos")]
pub(super) async fn reconcile_system_dns(config: &Mapping) {
    crate::utils::resolve::dns::restore_public_dns().await;
    if should_override_system_dns(config) {
        crate::utils::resolve::dns::set_public_dns("114.114.114.114".to_string()).await;
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::should_override_system_dns;
    use serde_yaml_ng::Mapping;

    #[test]
    fn final_config_decides_whether_macos_dns_is_overridden() {
        let cases = [
            ("tun: {enable: true}\ndns: {enable: true, enhanced-mode: fake-ip}", true),
            (
                "tun: {enable: true}\ndns: {enable: true, enhanced-mode: redir-host}",
                false,
            ),
            (
                "tun: {enable: true}\ndns: {enable: false, enhanced-mode: fake-ip}",
                false,
            ),
            (
                "tun: {enable: false}\ndns: {enable: true, enhanced-mode: fake-ip}",
                false,
            ),
            (
                "tun: {enable: true}\ndns: {enable: true, enhanced-mode: unknown}",
                false,
            ),
        ];

        for (yaml, expected) in cases {
            let config: Mapping = serde_yaml_ng::from_str(yaml).expect("test config should be valid");
            assert_eq!(should_override_system_dns(&config), expected, "config: {yaml}");
        }
    }
}

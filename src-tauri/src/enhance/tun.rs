use serde_yaml_ng::{Mapping, Value};

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

#[cfg(target_os = "macos")]
fn should_manage_tun_dns(config: &Mapping) -> bool {
    let tun_enabled = config
        .get(Value::from("tun"))
        .and_then(Value::as_mapping)
        .and_then(|tun| tun.get(Value::from("enable")))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let enhanced_mode = config
        .get(Value::from("dns"))
        .and_then(Value::as_mapping)
        .and_then(|dns| dns.get(Value::from("enhanced-mode")))
        .and_then(Value::as_str)
        .unwrap_or("fake-ip");
    tun_enabled && enhanced_mode == "fake-ip"
}

/// The final runtime config is the source of truth for whether the system DNS
/// must be managed: it already folds in `enable_tun_mode && !tun_suppressed_for_session()`
/// (see `enhance::get_config_values`), so reading `tun.enable` here accounts for
/// session suppression that the stored `verge().enable_tun_mode` alone would miss.
#[cfg(target_os = "macos")]
pub(super) fn reconcile_system_dns(config: &Mapping) {
    crate::utils::resolve::dns::schedule_tun_dns_reconciliation(should_manage_tun_dns(config));
}

#[cfg(all(test, target_os = "macos"))]
#[allow(clippy::expect_used)]
mod tests {
    use super::should_manage_tun_dns;
    use serde_yaml_ng::Mapping;

    fn mapping(yaml: &str) -> Mapping {
        serde_yaml_ng::from_str(yaml).expect("test TUN config should be valid")
    }

    #[test]
    fn final_runtime_config_controls_system_dns_management() {
        assert!(should_manage_tun_dns(&mapping(
            r"{tun: {enable: true}, dns: {enhanced-mode: fake-ip}}"
        )));
        assert!(!should_manage_tun_dns(&mapping(
            r"{tun: {enable: false}, dns: {enhanced-mode: fake-ip}}"
        )));
        assert!(!should_manage_tun_dns(&mapping(
            r"{tun: {enable: true}, dns: {enhanced-mode: redir-host}}"
        )));
    }
}

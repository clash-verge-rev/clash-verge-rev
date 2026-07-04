use super::runtime::SMART_CORE;
use serde_yaml_ng::{Mapping, Value};
use std::{collections::HashSet, net::IpAddr};

#[cfg(target_os = "macos")]
use crate::process::AsyncHandler;

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

            #[cfg(target_os = "macos")]
            {
                AsyncHandler::spawn(move || async move {
                    crate::utils::resolve::dns::restore_public_dns().await;
                    crate::utils::resolve::dns::set_public_dns("114.114.114.114".to_string()).await;
                });
            }
        }

        // 当TUN启用时，将修改后的DNS配置写回
        revise!(config, "dns", dns_val);
    } else {
        // TUN未启用时，仅恢复系统DNS，不修改配置文件中的DNS设置
        #[cfg(target_os = "macos")]
        AsyncHandler::spawn(move || async move {
            crate::utils::resolve::dns::restore_public_dns().await;
        });
    }

    // 更新TUN配置
    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);

    config
}

pub(super) fn use_smart_tun_route_exclude(mut config: Mapping, core: Option<&str>, enable_tun: bool) -> Mapping {
    if !enable_tun || !matches!(core, Some(SMART_CORE)) {
        return config;
    }

    let proxy_server_cidrs = collect_proxy_server_cidrs(&config);
    if proxy_server_cidrs.is_empty() {
        return config;
    }

    let tun_key = Value::from("tun");
    let mut tun = config.get(&tun_key).map_or_else(Mapping::new, |val| {
        val.as_mapping().cloned().unwrap_or_else(Mapping::new)
    });

    let route_exclude_key = Value::from("route-exclude-address");
    let mut route_exclude_addresses = tun
        .get(&route_exclude_key)
        .and_then(Value::as_sequence)
        .cloned()
        .unwrap_or_default();

    let mut existing = HashSet::new();
    for address in &route_exclude_addresses {
        if let Some(address) = address.as_str() {
            add_route_exclude_keys(&mut existing, address);
        }
    }

    for cidr in proxy_server_cidrs {
        if existing.contains(&cidr) {
            continue;
        }

        route_exclude_addresses.push(Value::String(cidr.clone()));
        add_route_exclude_keys(&mut existing, &cidr);
    }

    tun.insert(route_exclude_key, Value::Sequence(route_exclude_addresses));
    config.insert(tun_key, Value::Mapping(tun));
    config
}

fn collect_proxy_server_cidrs(config: &Mapping) -> Vec<std::string::String> {
    let Some(proxies) = config.get("proxies").and_then(Value::as_sequence) else {
        return Vec::new();
    };

    let mut cidrs = Vec::new();
    let mut seen = HashSet::new();
    for proxy in proxies {
        let Some(proxy) = proxy.as_mapping() else {
            continue;
        };
        let Some(server) = proxy.get("server").and_then(value_to_server_string) else {
            continue;
        };
        let Some(cidr) = cidr_from_host(&server) else {
            continue;
        };
        if seen.insert(cidr.clone()) {
            cidrs.push(cidr);
        }
    }

    cidrs
}

fn value_to_server_string(value: &Value) -> Option<std::string::String> {
    match value {
        Value::String(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn cidr_from_host(host: &str) -> Option<std::string::String> {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    let ip: IpAddr = host.parse().ok()?;
    Some(match ip {
        IpAddr::V4(ip) => format!("{ip}/32"),
        IpAddr::V6(ip) => format!("{ip}/128"),
    })
}

fn add_route_exclude_keys(existing: &mut HashSet<std::string::String>, address: &str) {
    let address = address.trim();
    if address.is_empty() {
        return;
    }

    existing.insert(address.to_ascii_lowercase());

    let host = address.split_once('/').map_or(address, |(host, _)| host);
    if let Some(cidr) = cidr_from_host(host) {
        existing.insert(cidr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml_to_mapping(yaml: &str) -> Result<Mapping, serde_yaml_ng::Error> {
        serde_yaml_ng::from_str(yaml)
    }

    fn route_exclude_addresses(config: &Mapping) -> Option<Vec<&str>> {
        config
            .get("tun")
            .and_then(|value| value.get("route-exclude-address"))
            .and_then(Value::as_sequence)
            .map(|addresses| addresses.iter().filter_map(Value::as_str).collect())
    }

    #[test]
    fn smart_tun_route_exclude_adds_ip_proxy_servers() -> Result<(), serde_yaml_ng::Error> {
        let config = yaml_to_mapping(
            r#"
proxies:
  - name: ipv4
    server: 1.2.3.4
  - name: ipv6
    server: "[2001:db8::1]"
tun:
  enable: true
  route-exclude-address:
    - 10.0.0.0/8
"#,
        )?;

        let config = use_smart_tun_route_exclude(config, Some(SMART_CORE), true);
        let route_exclude_addresses = route_exclude_addresses(&config);

        assert_eq!(
            route_exclude_addresses,
            Some(vec!["10.0.0.0/8", "1.2.3.4/32", "2001:db8::1/128"])
        );
        Ok(())
    }

    #[test]
    fn smart_tun_route_exclude_skips_domains_and_deduplicates_existing_values() -> Result<(), serde_yaml_ng::Error> {
        let config = yaml_to_mapping(
            r"
proxies:
  - name: domain
    server: example.com
  - name: duplicate-cidr
    server: 1.2.3.4
  - name: duplicate-bare
    server: 5.6.7.8
tun:
  route-exclude-address:
    - 1.2.3.4/32
    - 5.6.7.8
",
        )?;

        let config = use_smart_tun_route_exclude(config, Some(SMART_CORE), true);
        let route_exclude_addresses = route_exclude_addresses(&config);

        assert_eq!(route_exclude_addresses, Some(vec!["1.2.3.4/32", "5.6.7.8"]));
        Ok(())
    }

    #[test]
    fn smart_tun_route_exclude_requires_smart_core_and_tun() -> Result<(), serde_yaml_ng::Error> {
        let config = yaml_to_mapping(
            r"
proxies:
  - name: ipv4
    server: 1.2.3.4
tun:
  route-exclude-address: []
",
        )?;

        let non_smart_config = use_smart_tun_route_exclude(config.clone(), Some("verge-mihomo"), true);
        assert_eq!(route_exclude_addresses(&non_smart_config), Some(Vec::new()));

        let disabled_tun_config = use_smart_tun_route_exclude(config, Some(SMART_CORE), false);
        assert_eq!(route_exclude_addresses(&disabled_tun_config), Some(Vec::new()));
        Ok(())
    }
}

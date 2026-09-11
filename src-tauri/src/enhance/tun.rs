use serde_yaml_ng::{Mapping, Value};

#[cfg(target_os = "macos")]
use crate::process::AsyncHandler;

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
        let dns_key = Value::from("dns");
        let dns_val = config.get(&dns_key);
        let mut dns_val = dns_val.map_or_else(Mapping::new, |val| {
            val.as_mapping().cloned().unwrap_or_else(Mapping::new)
        });
        let ipv6_key = Value::from("ipv6");
        let ipv6_val = config.get(&ipv6_key).and_then(|v| v.as_bool()).unwrap_or(false);
        // Accepting IPv6 connections does not require returning AAAA DNS answers.
        // Preserve an explicit DNS opt-out, while still honoring the core switch.
        let dns_ipv6 = ipv6_val && dns_val.get(&ipv6_key).and_then(Value::as_bool).unwrap_or(true);

        let current_mode = dns_val
            .get(Value::from("enhanced-mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("fake-ip");

        if current_mode == "fake-ip" || !dns_val.contains_key(Value::from("enhanced-mode")) {
            revise!(dns_val, "enable", true);
            revise!(dns_val, "ipv6", dns_ipv6);

            if !dns_val.contains_key(Value::from("enhanced-mode")) {
                revise!(dns_val, "enhanced-mode", "fake-ip");
            }

            if !dns_val.contains_key(Value::from("fake-ip-range")) {
                revise!(dns_val, "fake-ip-range", "198.18.0.1/16");
            }

            if dns_ipv6 && !dns_val.contains_key(Value::from("fake-ip-range6")) {
                revise!(dns_val, "fake-ip-range6", "2001:2::0/64");
            }

            #[cfg(target_os = "macos")]
            {
                AsyncHandler::spawn(move || async move {
                    crate::utils::resolve::dns::restore_public_dns().await;
                    crate::utils::resolve::dns::set_public_dns("114.114.114.114".to_string()).await;
                });
            }
        }

        revise!(config, "dns", dns_val);
    } else {
        #[cfg(target_os = "macos")]
        AsyncHandler::spawn(move || async move {
            crate::utils::resolve::dns::restore_public_dns().await;
        });
    }

    revise!(tun_val, "enable", enable);
    revise!(config, "tun", tun_val);

    config
}

#[cfg(test)]
mod tests {
    use super::use_tun;
    use serde_yaml_ng::{Mapping, Value};

    #[tokio::test]
    async fn explicit_dns_ipv6_opt_out_survives_tun_regeneration() -> anyhow::Result<()> {
        for mode in ["", "  enhanced-mode: fake-ip\n"] {
            let input =
                format!("ipv6: true\ndns:\n  ipv6: false\n  nameserver: [223.5.5.5]\n{mode}tun:\n  stack: mixed\n");
            let config: Mapping = serde_yaml_ng::from_str(&input)?;
            let enabled = use_tun(config, true);
            for result in [&enabled, &use_tun(use_tun(enabled.clone(), false), true)] {
                assert_eq!(result.get("ipv6"), Some(&Value::from(true)));
                assert_eq!(result["dns"]["ipv6"], Value::from(false));
                assert!(result["dns"].get("fake-ip-range6").is_none());
                assert_eq!(result["dns"]["nameserver"][0], Value::from("223.5.5.5"));
                assert_eq!(result["tun"]["enable"], Value::from(true));
                assert_eq!(result["tun"]["stack"], Value::from("mixed"));
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn dns_ipv6_still_defaults_to_and_is_limited_by_the_core_switch() -> anyhow::Result<()> {
        for (input, expected) in [
            ("ipv6: true", true),
            ("ipv6: true\ndns: {ipv6: true}", true),
            ("ipv6: false\ndns: {ipv6: true}", false),
            ("dns: {ipv6: true}", false),
        ] {
            let result = use_tun(serde_yaml_ng::from_str(input)?, true);
            assert_eq!(result["dns"]["ipv6"], Value::from(expected), "{input}");
            assert_eq!(result["dns"].get("fake-ip-range6").is_some(), expected, "{input}");
        }
        Ok(())
    }

    #[tokio::test]
    async fn explicit_dns_ipv6_opt_out_preserves_an_existing_range() -> anyhow::Result<()> {
        let config = serde_yaml_ng::from_str("ipv6: true\ndns: {ipv6: false, fake-ip-range6: '2001:2::/64'}")?;
        let result = use_tun(config, true);
        assert_eq!(result["dns"]["ipv6"], Value::from(false));
        assert_eq!(result["dns"]["fake-ip-range6"], Value::from("2001:2::/64"));
        Ok(())
    }
}

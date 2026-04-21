use crate::config::Config;
use crate::constants::{network, tun as tun_const};
use crate::utils::dirs::{ipc_path, path_to_str};
use crate::utils::{dirs, help};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    str::FromStr as _,
};

#[derive(Default, Debug, Clone)]
pub struct IClashTemp(pub Mapping);

impl IClashTemp {
    pub async fn new() -> Self {
        let clash_path_result = dirs::clash_path();
        let map_result = if let Ok(path) = clash_path_result {
            help::read_mapping(&path).await
        } else {
            Err(anyhow::anyhow!("Failed to get clash path"))
        };

        match map_result {
            Ok(mut map) => {
                let template_map = Self::template().0;
                for (key, value) in template_map.into_iter() {
                    if !map.contains_key(&key) {
                        map.insert(key, value);
                    }
                }

                // 确保 secret 字段存在且不为空
                if let Some(val) = map.get_mut("secret")
                    && let Value::String(s) = val
                    && s.is_empty()
                {
                    *s = "set-your-secret".into();
                }

                Self(Self::guard(map))
            }
            Err(err) => {
                logging!(error, Type::Config, "{err}");
                Self::template()
            }
        }
    }

    pub fn template() -> Self {
        let mut map = Mapping::new();
        let mut tun_config = Mapping::new();
        let mut cors_map = Mapping::new();

        tun_config.insert("enable".into(), false.into());
        tun_config.insert("stack".into(), tun_const::DEFAULT_STACK.into());
        tun_config.insert("auto-route".into(), true.into());
        tun_config.insert("strict-route".into(), false.into());
        tun_config.insert("auto-detect-interface".into(), true.into());
        tun_config.insert("dns-hijack".into(), tun_const::DNS_HIJACK.into());

        #[cfg(not(target_os = "windows"))]
        map.insert("redir-port".into(), network::ports::DEFAULT_REDIR.into());
        #[cfg(target_os = "linux")]
        map.insert("tproxy-port".into(), network::ports::DEFAULT_TPROXY.into());

        map.insert("mixed-port".into(), network::ports::DEFAULT_MIXED.into());
        map.insert("socks-port".into(), network::ports::DEFAULT_SOCKS.into());
        map.insert("port".into(), network::ports::DEFAULT_HTTP.into());
        map.insert("log-level".into(), "info".into());
        map.insert("allow-lan".into(), false.into());
        map.insert("ipv6".into(), true.into());
        map.insert("mode".into(), "rule".into());
        map.insert(
            "external-controller".into(),
            network::DEFAULT_EXTERNAL_CONTROLLER.into(),
        );
        #[cfg(unix)]
        map.insert(
            "external-controller-unix".into(),
            Self::guard_external_controller_ipc().into(),
        );
        #[cfg(windows)]
        map.insert(
            "external-controller-pipe".into(),
            Self::guard_external_controller_ipc().into(),
        );
        map.insert("tun".into(), tun_config.into());
        cors_map.insert("allow-private-network".into(), true.into());
        cors_map.insert(
            "allow-origins".into(),
            vec![
                "tauri://localhost",
                "http://tauri.localhost",
                // Only enable this in dev mode
                #[cfg(feature = "verge-dev")]
                "http://localhost:3000",
                "https://yacd.metacubex.one",
                "https://metacubex.github.io",
                "https://board.zash.run.place",
            ]
            .into(),
        );
        map.insert("secret".into(), "set-your-secret".into());
        map.insert("external-controller-cors".into(), cors_map.into());
        map.insert("unified-delay".into(), true.into());
        Self(map)
    }

    fn guard(mut config: Mapping) -> Mapping {
        #[cfg(not(target_os = "windows"))]
        let redir_port = Self::guard_redir_port(&config);
        #[cfg(target_os = "linux")]
        let tproxy_port = Self::guard_tproxy_port(&config);
        let mixed_port = Self::guard_mixed_port(&config);
        let socks_port = Self::guard_socks_port(&config);
        let port = Self::guard_port(&config);
        let ctrl = Self::guard_external_controller(&config);
        #[cfg(unix)]
        let external_controller_unix = Self::guard_external_controller_ipc();
        #[cfg(windows)]
        let external_controller_pipe = Self::guard_external_controller_ipc();

        #[cfg(not(target_os = "windows"))]
        config.insert("redir-port".into(), redir_port.into());
        #[cfg(target_os = "linux")]
        config.insert("tproxy-port".into(), tproxy_port.into());
        config.insert("mixed-port".into(), mixed_port.into());
        config.insert("socks-port".into(), socks_port.into());
        config.insert("port".into(), port.into());
        config.insert("external-controller".into(), ctrl.into());

        #[cfg(unix)]
        config.insert("external-controller-unix".into(), external_controller_unix.into());
        #[cfg(windows)]
        config.insert("external-controller-pipe".into(), external_controller_pipe.into());
        config
    }

    pub fn patch_config(&mut self, patch: &Mapping) {
        for (key, value) in patch.iter() {
            self.0.insert(key.to_owned(), value.to_owned());
        }
    }

    pub async fn save_config(&self) -> Result<()> {
        help::save_yaml(&dirs::clash_path()?, &self.0, Some("# Generated by Clash Verge")).await
    }

    pub fn get_mixed_port(&self) -> u16 {
        Self::guard_mixed_port(&self.0)
    }

    #[allow(unused)]
    pub fn get_socks_port(&self) -> u16 {
        Self::guard_socks_port(&self.0)
    }

    #[allow(unused)]
    pub fn get_port(&self) -> u16 {
        Self::guard_port(&self.0)
    }

    pub fn get_client_info(&self) -> ClashInfo {
        let config = &self.0;

        ClashInfo {
            mixed_port: Self::guard_mixed_port(config),
            socks_port: Self::guard_socks_port(config),
            port: Self::guard_port(config),
            server: Self::guard_client_ctrl(config),
            secret: config.get("secret").and_then(|value| match value {
                Value::String(val_str) => Some(val_str.clone()),
                Value::Bool(val_bool) => Some(val_bool.to_string()),
                Value::Number(val_num) => Some(val_num.to_string()),
                _ => None,
            }),
        }
    }
    #[cfg(not(target_os = "windows"))]
    pub fn guard_redir_port(config: &Mapping) -> u16 {
        let mut port = config
            .get("redir-port")
            .and_then(|value| match value {
                Value::String(val_str) => val_str.parse().ok(),
                Value::Number(val_num) => val_num.as_u64().map(|u| u as u16),
                _ => None,
            })
            .unwrap_or(7895);
        if port == 0 {
            port = 7895;
        }
        port
    }

    #[cfg(target_os = "linux")]
    pub fn guard_tproxy_port(config: &Mapping) -> u16 {
        let mut port = config
            .get("tproxy-port")
            .and_then(|value| match value {
                Value::String(val_str) => val_str.parse().ok(),
                Value::Number(val_num) => val_num.as_u64().map(|u| u as u16),
                _ => None,
            })
            .unwrap_or(network::ports::DEFAULT_TPROXY);
        if port == 0 {
            port = network::ports::DEFAULT_TPROXY;
        }
        port
    }

    pub fn guard_mixed_port(config: &Mapping) -> u16 {
        let raw_value = config.get("mixed-port");

        let mut port = raw_value
            .and_then(|value| match value {
                Value::String(val_str) => val_str.parse().ok(),
                Value::Number(val_num) => val_num.as_u64().map(|u| u as u16),
                _ => None,
            })
            .unwrap_or(7897);

        if port == 0 {
            port = 7897;
        }

        port
    }

    pub fn guard_socks_port(config: &Mapping) -> u16 {
        let mut port = config
            .get("socks-port")
            .and_then(|value| match value {
                Value::String(val_str) => val_str.parse().ok(),
                Value::Number(val_num) => val_num.as_u64().map(|u| u as u16),
                _ => None,
            })
            .unwrap_or(7898);
        if port == 0 {
            port = 7898;
        }
        port
    }

    pub fn guard_port(config: &Mapping) -> u16 {
        let mut port = config
            .get("port")
            .and_then(|value| match value {
                Value::String(val_str) => val_str.parse().ok(),
                Value::Number(val_num) => val_num.as_u64().map(|u| u as u16),
                _ => None,
            })
            .unwrap_or(7899);
        if port == 0 {
            port = 7899;
        }
        port
    }

    pub fn guard_server_ctrl(config: &Mapping) -> String {
        config
            .get("external-controller")
            .and_then(|value| match value.as_str() {
                Some(val_str) => {
                    let val_str = val_str.trim();

                    let val = match val_str.starts_with(':') {
                        true => format!("127.0.0.1{val_str}"),
                        false => val_str.to_owned(),
                    };

                    SocketAddr::from_str(val.as_str()).ok().map(|s| s.to_string())
                }
                None => None,
            })
            .unwrap_or_else(|| "127.0.0.1:9097".into())
    }

    pub fn guard_external_controller(config: &Mapping) -> String {
        // 在初始化阶段，直接返回配置中的值，不进行额外检查
        // 这样可以避免在配置加载期间的循环依赖
        Self::guard_server_ctrl(config)
    }

    pub async fn guard_external_controller_with_setting(config: &Mapping) -> String {
        // 检查 enable_external_controller 设置，用于运行时配置生成
        let enable_external_controller = Config::verge()
            .await
            .latest_arc()
            .enable_external_controller
            .unwrap_or(false);

        if enable_external_controller {
            Self::guard_server_ctrl(config)
        } else {
            "".into()
        }
    }

    pub fn guard_client_ctrl(config: &Mapping) -> String {
        let value = Self::guard_server_ctrl(config);
        match SocketAddr::from_str(value.as_str()) {
            Ok(mut socket) => {
                if socket.ip().is_unspecified() {
                    socket.set_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
                }
                socket.to_string()
            }
            Err(_) => "127.0.0.1:9097".into(),
        }
    }

    pub fn guard_external_controller_ipc() -> String {
        // 总是使用当前的 IPC 路径，确保配置文件与运行时路径一致
        ipc_path()
            .ok()
            .and_then(|path| path_to_str(&path).ok().map(|s| s.into()))
            .unwrap_or_else(|| {
                logging!(error, Type::Config, "Failed to get IPC path");
                crate::constants::network::DEFAULT_EXTERNAL_CONTROLLER.into()
            })
    }
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ClashInfo {
    /// clash core port
    pub mixed_port: u16,
    pub socks_port: u16,
    pub port: u16,
    /// same as `external-controller`
    pub server: String,
    /// clash secret
    pub secret: Option<String>,
}

#[test]
fn test_clash_info() {
    fn get_case<T: Into<Value>, D: Into<Value>>(mp: T, ec: D) -> ClashInfo {
        let mut map = Mapping::new();
        map.insert("mixed-port".into(), mp.into());
        map.insert("external-controller".into(), ec.into());

        IClashTemp(IClashTemp::guard(map)).get_client_info()
    }

    fn get_result<S: Into<String>>(port: u16, server: S) -> ClashInfo {
        ClashInfo {
            mixed_port: port,
            socks_port: 7898,
            port: 7899,
            server: server.into(),
            secret: None,
        }
    }

    assert_eq!(
        IClashTemp(IClashTemp::guard(Mapping::new())).get_client_info(),
        get_result(7897, "127.0.0.1:9097")
    );

    assert_eq!(get_case("", ""), get_result(7897, "127.0.0.1:9097"));

    assert_eq!(get_case(65537, ""), get_result(1, "127.0.0.1:9097"));

    assert_eq!(get_case(8888, "127.0.0.1:8888"), get_result(8888, "127.0.0.1:8888"));

    assert_eq!(get_case(8888, "   :98888 "), get_result(8888, "127.0.0.1:9097"));

    assert_eq!(get_case(8888, "0.0.0.0:8080  "), get_result(8888, "127.0.0.1:8080"));

    assert_eq!(get_case(8888, "0.0.0.0:8080"), get_result(8888, "127.0.0.1:8080"));

    assert_eq!(get_case(8888, "[::]:8080"), get_result(8888, "127.0.0.1:8080"));

    assert_eq!(get_case(8888, "192.168.1.1:8080"), get_result(8888, "192.168.1.1:8080"));

    assert_eq!(get_case(8888, "192.168.1.1:80800"), get_result(8888, "127.0.0.1:9097"));
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashExternalControllerCors {
    pub allow_origins: Option<Vec<String>>,
    pub allow_private_network: Option<bool>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClash {
    pub mixed_port: Option<u16>,
    pub allow_lan: Option<bool>,
    pub log_level: Option<String>,
    pub ipv6: Option<bool>,
    pub mode: Option<String>,
    pub external_controller: Option<String>,
    pub secret: Option<String>,
    pub dns: Option<IClashDNS>,
    pub tun: Option<IClashTUN>,
    pub interface_name: Option<String>,
    pub external_controller_cors: Option<IClashExternalControllerCors>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashTUN {
    pub enable: Option<bool>,
    pub stack: Option<String>,
    pub auto_route: Option<bool>,
    pub auto_detect_interface: Option<bool>,
    pub dns_hijack: Option<Vec<String>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashDNS {
    pub enable: Option<bool>,
    pub listen: Option<String>,
    pub default_nameserver: Option<Vec<String>>,
    pub enhanced_mode: Option<String>,
    pub fake_ip_range: Option<String>,
    pub use_hosts: Option<bool>,
    pub fake_ip_filter: Option<Vec<String>>,
    pub nameserver: Option<Vec<String>>,
    pub fallback: Option<Vec<String>>,
    pub fallback_filter: Option<IClashFallbackFilter>,
    pub nameserver_policy: Option<Vec<String>>,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct IClashFallbackFilter {
    pub geoip: Option<bool>,
    pub geoip_code: Option<String>,
    pub ipcidr: Option<Vec<String>>,
    pub domain: Option<Vec<String>>,
}

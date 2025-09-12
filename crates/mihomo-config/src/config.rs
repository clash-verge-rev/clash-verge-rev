//! 配置文件的解析
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub socks_port: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub redir_port: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tproxy_port: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mixed_port: Option<i32>,

    #[serde(rename = "ss-config")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadowsocks_config: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub vmess_config: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_tfo: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_mptcp: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub authentication: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_auth_prefixes: Option<Vec<String>>, // Go: netip.Prefix

    #[serde(skip_serializing_if = "Option::is_none")]
    pub lan_allowed_ips: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub lan_disallowed_ips: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_lan: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_address: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<TunnelMode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub unified_delay: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_level: Option<LogLevel>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv6: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_controller: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_controller_pipe: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_controller_unix: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_controller_tls: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_controller_cors: Option<RawCors>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ui: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ui_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ui_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_doh_server: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub routing_mark: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnels: Option<Vec<Tunnel>>, // LC.Tunnel

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geo_auto_update: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geo_update_interval: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geodata_mode: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geodata_loader: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geosite_matcher: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp_concurrent: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub find_process_mode: Option<FindProcessMode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_client_fingerprint: Option<String>,
    /// default clash.meta/[mihomo version]

    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_ua: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag_support: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive_idle: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_alive_interval: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub disable_keep_alive: Option<bool>,

    // TODO: replace all serde_yaml_ng::Value to custom struct, like `ProxyProvider` struct
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_providers: Option<HashMap<String, HashMap<String, serde_yaml_ng::Value>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_providers: Option<HashMap<String, HashMap<String, serde_yaml_ng::Value>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxies: Option<Vec<HashMap<String, serde_yaml_ng::Value>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_groups: Option<Vec<HashMap<String, serde_yaml_ng::Value>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_rules: Option<HashMap<String, Vec<String>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub listeners: Option<Vec<HashMap<String, serde_yaml_ng::Value>>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub hosts: Option<HashMap<String, serde_yaml_ng::Value>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<RawDNS>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ntp: Option<RawNTP>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tun: Option<RawTun>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tuic_server: Option<RawTuicServer>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub iptables: Option<RawIPTables>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<RawExperimental>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<RawProfile>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geox_url: Option<RawGeoXUrl>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sniffer: Option<RawSniffer>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<RawTLS>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub clash_for_android: Option<RawClashForAndroid>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawCors {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_origins: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_private_network: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Tunnel {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawDNS {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefer_h3: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv6: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv6_timeout: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_hosts: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_system_hosts: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub respect_rules: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nameserver: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_filter: Option<RawFallbackFilter>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub listen: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub enhanced_mode: Option<DNSMode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fake_ip_range: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fake_ip_filter: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub fake_ip_filter_mode: Option<FilterMode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_nameserver: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_algorithm: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_max_size: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nameserver_policy: Option<IndexMap<String, serde_yaml_ng::Value>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_server_nameserver: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_nameserver: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_nameserver_follow_policy: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RawFallbackFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geoip: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geoip_code: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipcidr: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geosite: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DNSMode {
    Normal,
    FakeIp,
    Mapping,
    Hosts,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterMode {
    Blacklist,
    Whitelist,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawNTP {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialer_proxy: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_to_system: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawTun {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<TunStack>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns_hijack: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_route: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_detect_interface: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtu: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub gso: Option<bool>,
    #[serde(rename = "gso-max-size")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gso_max_size: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inet6_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub iproute2_table_index: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub iproute2_rule_index: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_redirect: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_redirect_input_mark: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_redirect_output_mark: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub loopback_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub strict_route: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_address_set: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_exclude_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_exclude_address_set: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_interface: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_interface: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_uid: Option<Vec<u32>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_uid_range: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_uid: Option<Vec<u32>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_uid_range: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_src_port: Option<Vec<u16>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_src_port_range: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_dst_port: Option<Vec<u16>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_dst_port_range: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_android_user: Option<Vec<i32>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_package: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_package: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_independent_nat: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub udp_timeout: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_descriptor: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inet4_route_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inet6_route_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inet4_route_exclude_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inet6_route_exclude_address: Option<Vec<String>>,

    // Darwin special config
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recvmsgx: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sendmsgx: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunStack {
    System,
    GVisor,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawTuicServer {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub listen: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<HashMap<String, String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub certificate: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub congestion_controller: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_idle_time: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub authentication_timeout: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub alpn: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_udp_relay_packet_size: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwnd: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawIPTables {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_interface: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub bypass: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns_redirect: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawExperimental {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprints: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub quic_go_disable_gso: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub quic_go_disable_ecn: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialer_ip4p_convert: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_selected: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_fake_ip: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawGeoXUrl {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geoip: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmdb: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub asn: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub geosite: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawSniffer {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_destination: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sniffing: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_domain: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_src_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_dst_address: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_domain: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_whitelist: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_dns_mapping: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_pure_ip: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sniff: Option<HashMap<String, RawSniffingConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawSniffingConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ports: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_destination: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct RawTLS {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub certificate: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ech_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_certifactes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RawClashForAndroid {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_system_dns: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_subtitle_pattern: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelMode {
    Rule,
    Global,
    Direct,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Silent,
    Error,
    Warning,
    Info,
    Debug,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindProcessMode {
    Always,
    Strict,
    Off,
}

impl Default for RawConfig {
    fn default() -> Self {
        Self {
            port: None,
            socks_port: None,
            redir_port: None,
            tproxy_port: None,
            mixed_port: None,
            shadowsocks_config: None,
            vmess_config: None,
            inbound_tfo: None,
            inbound_mptcp: None,
            authentication: Some(vec![]),
            skip_auth_prefixes: None,
            lan_allowed_ips: Some(vec![String::from("0.0.0.0/0"), String::from("::/0")]),
            lan_disallowed_ips: None,
            allow_lan: Some(false),
            bind_address: Some(String::from("*")),
            mode: Some(TunnelMode::Rule),
            unified_delay: Some(false),
            log_level: Some(LogLevel::Info),
            ipv6: Some(true),
            external_controller: None,
            external_controller_pipe: None,
            external_controller_unix: None,
            external_controller_tls: None,
            external_controller_cors: Some(RawCors {
                allow_origins: Some(vec![String::from("*")]),
                allow_private_network: Some(true),
            }),
            external_ui: Some(String::from(
                "https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip",
            )),
            external_ui_url: None,
            external_ui_name: None,
            external_doh_server: None,
            secret: None,
            interface: None,
            routing_mark: None,
            tunnels: None,
            geo_auto_update: Some(false),
            geo_update_interval: Some(24),
            geodata_mode: Some(false),
            geodata_loader: Some(String::from("memconservative")),
            geosite_matcher: None,
            tcp_concurrent: Some(false),
            find_process_mode: Some(FindProcessMode::Strict),
            global_client_fingerprint: None,
            global_ua: Some(String::from("clash.meta")),
            etag_support: Some(true),
            keep_alive_idle: None,
            keep_alive_interval: None,
            disable_keep_alive: None,
            proxy_providers: None,
            rule_providers: None,
            proxies: Some(vec![]),
            proxy_groups: Some(vec![]),
            rules: Some(vec![]),
            sub_rules: None,
            listeners: None,
            hosts: Some(HashMap::new()),
            dns: Some(RawDNS {
                enable: Some(false),
                prefer_h3: None,
                ipv6: Some(false),
                ipv6_timeout: Some(100),
                use_hosts: Some(true),
                use_system_hosts: Some(true),
                respect_rules: None,
                nameserver: Some(vec![
                    String::from("https://doh.pub/dns-query"),
                    String::from("tls://223.5.5.5:853"),
                ]),
                fallback: None,
                fallback_filter: Some(RawFallbackFilter {
                    geoip: Some(true),
                    geoip_code: Some(String::from("CN")),
                    ipcidr: Some(vec![]),
                    domain: None,
                    geosite: Some(vec![]),
                }),
                listen: None,
                enhanced_mode: Some(DNSMode::Mapping),
                fake_ip_range: Some(String::from("198.18.0.1/16")),
                fake_ip_filter: Some(vec![
                    String::from("dns.msftnsci.com"),
                    String::from("www.msftnsci.com"),
                    String::from("www.msftconnecttest.com"),
                ]),
                fake_ip_filter_mode: Some(FilterMode::Blacklist),
                default_nameserver: Some(vec![
                    String::from("114.114.114.114"),
                    String::from("223.5.5.5"),
                    String::from("8.8.8.8"),
                    String::from("1.0.0.1"),
                ]),
                cache_algorithm: None,
                cache_max_size: None,
                nameserver_policy: None,
                proxy_server_nameserver: None,
                direct_nameserver: None,
                direct_nameserver_follow_policy: None,
            }),
            ntp: Some(RawNTP {
                enable: Some(false),
                server: Some(String::from("time.apple.com")),
                port: Some(123),
                interval: Some(30),
                dialer_proxy: None,
                write_to_system: Some(false),
            }),
            tun: Some(RawTun {
                enable: Some(false),
                device: Some(String::new()),
                stack: Some(TunStack::GVisor),
                dns_hijack: Some(vec![String::from("0.0.0.0:53")]),
                auto_route: Some(true),
                auto_detect_interface: Some(true),
                mtu: None,
                gso: None,
                gso_max_size: None,
                inet6_address: Some(vec![String::from("fdfe:dcba:9876::1/126")]),
                iproute2_table_index: None,
                iproute2_rule_index: None,
                auto_redirect: None,
                auto_redirect_input_mark: None,
                auto_redirect_output_mark: None,
                loopback_address: None,
                strict_route: None,
                route_address: None,
                route_address_set: None,
                route_exclude_address: None,
                route_exclude_address_set: None,
                include_interface: None,
                exclude_interface: None,
                include_uid: None,
                include_uid_range: None,
                exclude_uid: None,
                exclude_uid_range: None,
                exclude_src_port: None,
                exclude_src_port_range: None,
                exclude_dst_port: None,
                exclude_dst_port_range: None,
                include_android_user: None,
                include_package: None,
                exclude_package: None,
                endpoint_independent_nat: None,
                udp_timeout: None,
                file_descriptor: None,
                inet4_route_address: None,
                inet6_route_address: None,
                inet4_route_exclude_address: None,
                inet6_route_exclude_address: None,
                recvmsgx: Some(true),
                sendmsgx: Some(false),
            }),
            tuic_server: Some(RawTuicServer {
                enable: Some(false),
                listen: None,
                token: None,
                users: None,
                certificate: None,
                private_key: None,
                congestion_controller: None,
                max_idle_time: Some(15000),
                authentication_timeout: Some(1000),
                alpn: Some(vec![String::from("h3")]),
                max_udp_relay_packet_size: Some(1500),
                cwnd: None,
            }),
            iptables: Some(RawIPTables {
                enable: Some(false),
                inbound_interface: Some(String::from("lo")),
                bypass: Some(vec![]),
                dns_redirect: Some(true),
            }),
            experimental: Some(RawExperimental {
                fingerprints: None,
                quic_go_disable_gso: Some(true),
                quic_go_disable_ecn: None,
                dialer_ip4p_convert: None,
            }),
            profile: Some(RawProfile {
                store_selected: Some(true),
                store_fake_ip: None,
            }),
            geox_url: Some(RawGeoXUrl {
                geoip: Some(String::from(
                    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb",
                )),
                mmdb: Some(String::from(
                    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
                )),
                asn: Some(String::from(
                    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat",
                )),
                geosite: Some(String::from(
                    "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
                )),
            }),
            sniffer: Some(RawSniffer {
                enable: Some(false),
                override_destination: Some(true),
                sniffing: None,
                force_domain: Some(vec![]),
                skip_src_address: None,
                skip_dst_address: None,
                skip_domain: Some(vec![]),
                port_whitelist: Some(vec![]),
                force_dns_mapping: Some(true),
                parse_pure_ip: Some(true),
                sniff: Some(HashMap::new()),
            }),
            tls: None,
            clash_for_android: None,
        }
    }
}

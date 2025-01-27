use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt::Display};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Http,
    Https,
}

impl Display for Protocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let protocol_str = match self {
            Protocol::Http => "http",
            Protocol::Https => "https",
        };
        write!(f, "{}", protocol_str)
    }
}

impl Default for Protocol {
    fn default() -> Self {
        Protocol::Http
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct BaseConfig {
    pub port: u32,
    pub mixed_port: u32,
    pub socks_port: u32,
    pub redir_port: u32,
    pub tproxy_port: u32,
    pub tun: TunConfig,
    // pub tuic_server: {},
    // pub ss_config: String,
    // pub vmess_config: String,
    // pub authentication: null,
    // pub skip_auth_prefixes: null,
    pub lan_allowed_ips: Option<Vec<String>>,
    pub lan_disallowed_ips: Option<Vec<String>>,
    pub allow_lan: bool,
    pub bind_address: String,
    pub inbound_tfo: bool,
    pub inbound_mptcp: bool,
    pub mode: ClashMode,
    pub unified_delay: bool,
    pub log_level: String,
    pub ipv6: bool,
    pub interface_name: String,
    pub routing_mark: u32,
    pub geox_url: HashMap<String, String>,
    pub geo_auto_update: bool,
    pub geo_update_interval: u16,
    pub geodata_mode: bool,
    pub geodata_loader: String,
    pub geosite_matcher: String,
    pub tcp_concurrent: bool,
    pub find_process_mode: String,
    pub sniffing: bool,
    pub global_client_fingerprint: String,
    pub global_ua: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct TunConfig {
    pub enable: bool,
    pub device: String,
    pub stack: TunStack,
    pub dns_hijack: Vec<String>,
    pub auto_route: bool,
    pub auto_detect_interface: bool,
    pub mtu: u32,
    pub gso_max_size: Option<u32>,
    pub inet4_address: Vec<String>,
    pub file_descriptor: u32,
}

/// mihomo version
#[derive(Debug, Serialize, Deserialize)]
pub struct MihomoVersion {
    pub meta: bool,
    pub version: String,
}

/// clash mode enum
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClashMode {
    Rule,
    Global,
    Direct,
}

impl Display for ClashMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let clash_mode_str = match self {
            ClashMode::Rule => "rule",
            ClashMode::Global => "global",
            ClashMode::Direct => "direct",
        };
        write!(f, "{}", clash_mode_str)
    }
}

/// tun stack enum
#[derive(Debug, Serialize, Deserialize)]
pub enum TunStack {
    #[serde(rename = "Mixed")]
    Mixed,
    #[serde(rename = "gVisor")]
    Gvisor,
    #[serde(rename = "System")]
    System,
}

impl Display for TunStack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tun_stack_str = match self {
            TunStack::Mixed => "Mixed",
            TunStack::Gvisor => "gVisor",
            TunStack::System => "System",
        };
        write!(f, "{}", tun_stack_str)
    }
}

/// proxies
#[derive(Debug, Serialize, Deserialize)]
pub struct GroupProxies {
    pub proxies: Vec<Proxy>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    pub id: Option<String>,
    pub alive: bool,
    pub all: Option<Vec<String>>,
    pub expected_status: Option<String>,
    pub extra: HashMap<String, Extra>,
    pub fixed: Option<String>,
    pub hidden: Option<bool>,
    pub history: Vec<DelayHistory>,
    pub icon: Option<String>,
    pub name: String,
    pub now: Option<String>,
    pub test_url: Option<String>,
    pub tfo: bool,
    #[serde(rename = "type")]
    pub group_type: String,
    pub udp: bool,
    pub xudp: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Extra {
    pub alive: bool,
    pub history: Vec<DelayHistory>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DelayHistory {
    pub time: String,
    pub delay: u16,
}

// pub enum GroupType {
//     URLTest("URLTest"),
// }

/// proxies
#[derive(Debug, Serialize, Deserialize)]
pub struct Proxies {
    pub proxies: HashMap<String, Proxy>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyDelay {
    pub delay: Option<u32>,
    /// show message only delay timeout
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Providers {
    pub providers: HashMap<String, ProxyProviders>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProviders {
    pub expected_status: String,
    pub name: String,
    pub proxies: Vec<Proxy>,
    pub test_url: String,
    #[serde(rename = "type")]
    pub proxy_type: String,
    pub vehicle_type: String,
    pub subscription_info: Option<SubScriptionInfo>,
    pub update_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SubScriptionInfo {
    pub upload: u64,
    pub download: u64,
    pub total: u64,
    pub expire: u64,
}

/// rules
#[derive(Debug, Serialize, Deserialize)]
pub struct Rules {
    pub rules: Vec<Rule>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Rule {
    #[serde(rename = "type")]
    pub rule_type: String,
    pub payload: String,
    pub proxy: String,
    pub size: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuleProviders {
    pub providers: HashMap<String, RuleProvider>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleProvider {
    pub behavior: String,
    pub format: String,
    pub name: String,
    pub rule_count: u32,
    #[serde(rename = "type")]
    pub rule_provider_type: String,
    pub updated_at: String,
    pub vehicle_type: String,
}

/// connections
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connections {
    pub download_total: u64,
    pub upload_total: u64,
    pub connections: Vec<Connection>,
    pub memory: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub metadata: ConnectionMetaData,
    pub upload: u64,
    pub download: u64,
    pub start: String,
    pub chains: Vec<String>,
    pub rule: String,
    pub rule_payload: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetaData {
    pub network: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    #[serde(rename = "sourceIP")]
    pub source_ip: String,
    #[serde(rename = "destinationIP")]
    pub destination_ip: String,
    #[serde(rename = "sourceGeoIP")]
    pub source_geo_ip: Option<String>,
    #[serde(rename = "destinationGeoIP")]
    pub destination_geo_ip: Option<String>,
    #[serde(rename = "sourceIPASN")]
    pub source_ip_asn: String,
    #[serde(rename = "destinationIPASN")]
    pub destination_ip_asn: String,
    pub source_port: String,
    pub destination_port: String,
    #[serde(rename = "inboundIP")]
    pub inbound_ip: String,
    pub inbound_port: String,
    pub inbound_name: String,
    pub inbound_user: String,
    pub host: String,
    pub dns_mode: String,
    pub uid: u8,
    pub process: String,
    pub process_path: String,
    pub special_proxy: String,
    pub special_rules: String,
    pub remote_destination: String,
    pub dscp: u32,
    pub sniff_host: String,
}

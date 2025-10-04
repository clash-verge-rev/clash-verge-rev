use std::{collections::HashMap, fmt::Display};

use futures_util::{SinkExt, stream::SplitSink};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpStream, sync::RwLock};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, tungstenite::Message};
use ts_rs::TS;

use crate::ipc::WrapStream;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    #[default]
    Http,
    LocalSocket,
}

impl Display for Protocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Protocol::Http => write!(f, "http"),
            Protocol::LocalSocket => {
                if cfg!(windows) {
                    write!(f, "named pipe")
                } else {
                    write!(f, "unix socket")
                }
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, rename_all = "camelCase")]
#[serde(rename_all(serialize = "camelCase", deserialize = "kebab-case"))]
pub struct BaseConfig {
    pub port: u32,
    pub socks_port: u32,
    pub redir_port: u32,
    pub tproxy_port: u32,
    pub mixed_port: u32,
    pub tun: TunConfig,
    pub tuic_server: TuicServer,
    pub ss_config: String,
    pub vmess_config: String,
    pub authentication: Option<Vec<String>>,
    pub skip_auth_prefixes: Option<Vec<String>>,
    pub lan_allowed_ips: Option<Vec<String>>,
    pub lan_disallowed_ips: Option<Vec<String>>,
    pub allow_lan: bool,
    pub bind_address: String,
    pub inbound_tfo: bool,
    pub inbound_mptcp: bool,
    pub mode: ClashMode,
    pub unified_delay: bool,
    pub log_level: LogLevel,
    pub ipv6: bool,
    pub interface_name: String,
    pub routing_mark: isize,
    pub geox_url: GeoXUrl,
    pub geo_auto_update: bool,
    pub geo_update_interval: isize,
    pub geodata_mode: bool,
    pub geodata_loader: String,
    pub geosite_matcher: String,
    pub tcp_concurrent: bool,
    pub find_process_mode: FindProcessMode,
    pub sniffing: bool,
    pub global_client_fingerprint: String,
    pub global_ua: String,
    pub etag_support: bool,
    pub keep_alive_interval: isize,
    pub keep_alive_idle: isize,
    pub disable_keep_alive: bool,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, rename_all = "camelCase")]
#[serde(rename_all(serialize = "camelCase", deserialize = "kebab-case"))]
pub struct TunConfig {
    pub enable: bool,
    pub device: String,
    pub stack: TunStack,
    pub dns_hijack: Vec<String>,
    pub auto_route: bool,
    pub auto_detect_interface: bool,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mtu: Option<u32>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub gso: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub gso_max_size: Option<u32>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet4_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet6_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub iproute2_table_index: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub iproute2_rule_index: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_redirect: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_redirect_input_mark: Option<u32>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_redirect_output_mark: Option<u32>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub loopback_address: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub strict_route: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub route_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub route_address_set: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub route_exclude_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub route_exclude_address_set: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_interface: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_interface: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_uid: Option<Vec<u32>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_uid_range: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_uid: Option<Vec<u32>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_uid_range: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_src_port: Option<Vec<u16>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_src_port_range: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_dst_port: Option<Vec<u16>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_dst_port_range: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_android_user: Option<Vec<isize>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_package: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclude_package: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub endpoint_independent_nat: Option<bool>,

    #[ts(optional)]
    #[ts(type = "number")]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub udp_timeout: Option<i64>,

    pub file_descriptor: u32,

    // The following `inet*` fields will be deprecated
    // refer: https://wiki.metacubex.one/config/inbound/tun/#_1
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet4_route_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet6_route_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet4_route_exclude_address: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub inet6_route_exclude_address: Option<Vec<String>>,

    // darwin special config
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub recvmsgx: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sendmsgx: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, rename_all = "camelCase")]
#[serde(rename_all(serialize = "camelCase", deserialize = "kebab-case"))]
pub struct TuicServer {
    pub enable: bool,
    pub listen: String,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub token: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub users: Option<HashMap<String, String>>,

    pub certificate: String,
    pub private_key: String,
    pub ech_key: String,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub congestion_controller: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_idle_time: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub authentication_timeout: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub alpn: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_udp_relay_packet_size: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_datagram_frame_size: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cwnd: Option<isize>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub mux_option: Option<MuxOption>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MuxOption {
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub padding: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub brutal: Option<BrutalOption>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BrutalOption {
    pub enabled: bool,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub up: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub down: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    DEBUG,
    INFO,
    WARNING,
    ERROR,
    SILENT,
}

impl Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::DEBUG => write!(f, "debug"),
            LogLevel::INFO => write!(f, "info"),
            LogLevel::WARNING => write!(f, "warning"),
            LogLevel::ERROR => write!(f, "error"),
            LogLevel::SILENT => write!(f, "silent"),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, rename_all = "camelCase")]
#[serde(rename_all(serialize = "camelCase", deserialize = "kebab-case"))]
pub struct GeoXUrl {
    pub geo_ip: String,
    pub mmdb: String,
    pub asn: String,
    pub geo_site: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum FindProcessMode {
    Strict,
    Always,
    Off,
}

/// mihomo version
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MihomoVersion {
    pub meta: bool,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum CoreUpdaterChannel {
    #[serde(rename = "release")]
    ReleaseChannel,
    #[serde(rename = "alpha")]
    AlphaChannel,
    #[serde(rename = "auto")]
    Auto,
}

impl Display for CoreUpdaterChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreUpdaterChannel::ReleaseChannel => write!(f, "release"),
            CoreUpdaterChannel::AlphaChannel => write!(f, "alpha"),
            CoreUpdaterChannel::Auto => write!(f, "auto"),
        }
    }
}

/// clash mode enum
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ClashMode {
    Rule,
    Global,
    Direct,
}

impl Display for ClashMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClashMode::Rule => write!(f, "rule"),
            ClashMode::Global => write!(f, "global"),
            ClashMode::Direct => write!(f, "direct"),
        }
    }
}

/// tun stack enum
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TunStack {
    Mixed,
    #[serde(rename = "gVisor")]
    Gvisor,
    System,
}

impl Display for TunStack {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunStack::Mixed => write!(f, "Mixed"),
            TunStack::Gvisor => write!(f, "gVisor"),
            TunStack::System => write!(f, "System"),
        }
    }
}

/// group proxies
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Groups {
    pub proxies: Vec<Proxy>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    // group type need
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub all: Option<Vec<String>>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub expected_status: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub fixed: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub hidden: Option<bool>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub icon: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub now: Option<String>,

    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub test_url: Option<String>,

    // single proxy type need
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub id: Option<String>,

    // basic fields
    pub alive: bool,
    pub history: Vec<DelayHistory>,
    pub extra: HashMap<String, Extra>,
    pub name: String,
    pub udp: bool,
    pub uot: bool,
    #[serde(rename = "type")]
    pub proxy_type: ProxyType,
    pub xudp: bool,
    pub tfo: bool,
    pub mptcp: bool,
    pub smux: bool,
    pub interface: String,

    #[serde(rename(serialize = "dialerProxy", deserialize = "dialer-proxy"))]
    pub dialer_proxy: String,

    #[serde(rename(serialize = "routingMark", deserialize = "routing-mark"))]
    pub routing_mark: i8,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ProxyType {
    Direct,
    Reject,
    RejectDrop,
    Compatible,
    Pass,
    Dns,
    Shadowsocks,
    ShadowsocksR,
    Snell,
    Socks5,
    Http,
    Vmess,
    Vless,
    Trojan,
    Hysteria,
    Hysteria2,
    WireGuard,
    Tuic,
    Ssh,
    Mieru,
    AnyTLS,
    Relay,
    Selector,
    Fallback,
    URLTest,
    LoadBalance,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Extra {
    pub alive: bool,
    pub history: Vec<DelayHistory>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DelayHistory {
    pub time: String,
    pub delay: u16,
}

/// proxies
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Proxies {
    pub proxies: HashMap<String, Proxy>,
}

/// proxy delay result
///
/// displays a message if it times out, otherwise it only displays the delay
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProxyDelay {
    pub delay: u32,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProxyProviders {
    pub providers: HashMap<String, ProxyProvider>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ProviderType {
    Proxy,
    Rule,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum VehicleType {
    File,
    HTTP,
    Compatible,
    Inline,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProvider {
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub vehicle_type: VehicleType,
    pub proxies: Vec<Proxy>,
    pub test_url: String,
    pub expected_status: String,
    pub updated_at: Option<String>,
    pub subscription_info: Option<SubScriptionInfo>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "PascalCase")]
pub struct SubScriptionInfo {
    #[ts(type = "number")]
    pub upload: i64,
    #[ts(type = "number")]
    pub download: i64,
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub expire: i64,
}

/// rules
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Rules {
    pub rules: Vec<Rule>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Rule {
    #[serde(rename = "type")]
    pub rule_type: RuleType,
    pub payload: String,
    pub proxy: String,
    pub size: i32,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RuleType {
    Domain,
    DomainSuffix,
    DomainKeyword,
    DomainRegex,
    GeoSite,
    GeoIP,
    SrcGeoIP,
    IPASN,
    SrcIPASN,
    IPCIDR,
    SrcIPCIDR,
    IPSuffix,
    SrcIPSuffix,
    SrcPort,
    DstPort,
    InPort,
    InUser,
    InName,
    InType,
    ProcessName,
    ProcessPath,
    ProcessNameRegex,
    ProcessPathRegex,
    Match,
    RuleSet,
    Network,
    DSCP,
    Uid,
    SubRules,
    AND,
    OR,
    NOT,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RuleProviders {
    pub providers: HashMap<String, RuleProvider>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RuleBehavior {
    Domain,
    #[serde(rename = "IPCIDR")]
    IpCidr,
    Classical,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RuleFormat {
    #[serde(rename = "YamlRule")]
    Yaml,
    #[serde(rename = "TextRule")]
    Text,
    #[serde(rename = "MrsRule")]
    Mrs,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuleProvider {
    pub behavior: RuleBehavior,
    pub format: RuleFormat,
    pub name: String,
    pub rule_count: u32,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub updated_at: String,
    pub vehicle_type: VehicleType,
}

/// connections
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Connections {
    #[ts(type = "number")]
    pub download_total: u64,
    #[ts(type = "number")]
    pub upload_total: u64,
    pub connections: Option<Vec<Connection>>,
    pub memory: u32,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub metadata: ConnectionMetaData,
    #[ts(type = "number")]
    pub upload: u64,
    #[ts(type = "number")]
    pub download: u64,
    pub start: String,
    pub chains: Vec<String>,
    pub rule: String,
    pub rule_payload: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Network {
    #[serde(rename = "tcp")]
    TCP,
    #[serde(rename = "udp")]
    UDP,
    #[serde(rename = "all")]
    ALLNet,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ConnectionType {
    HTTP,
    HTTPS,
    #[serde(rename = "Socks4")]
    SOCKS4,
    #[serde(rename = "Socks5")]
    SOCKS5,
    #[serde(rename = "ShadowSocks")]
    SHADOWSOCKS,
    #[serde(rename = "Vmess")]
    VMESS,
    #[serde(rename = "Vless")]
    VLESS,
    #[serde(rename = "Redir")]
    REDIR,
    #[serde(rename = "TProxy")]
    TPROXY,
    #[serde(rename = "Trojan")]
    TROJAN,
    #[serde(rename = "Tunnel")]
    TUNNEL,
    #[serde(rename = "Tun")]
    TUN,
    #[serde(rename = "Tuic")]
    TUIC,
    #[serde(rename = "Hysteria2")]
    HYSTERIA2,
    #[serde(rename = "AnyTLS")]
    ANYTLS,
    #[serde(rename = "Inner")]
    INNER,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DNSMode {
    #[serde(rename = "normal")]
    Normal,
    #[serde(rename = "fake-ip")]
    FakeIP,
    #[serde(rename = "redir-host")]
    Mapping,
    #[serde(rename = "hosts")]
    Hosts,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMetaData {
    pub network: Network,

    #[serde(rename = "type")]
    pub connection_type: ConnectionType,

    #[serde(rename = "sourceIP")]
    pub source_ip: String,

    #[serde(rename = "destinationIP")]
    pub destination_ip: String,

    #[serde(rename = "sourceGeoIP")]
    pub source_geo_ip: Option<Vec<String>>,

    #[serde(rename = "destinationGeoIP")]
    pub destination_geo_ip: Option<Vec<String>>,

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
    pub dns_mode: DNSMode,
    pub uid: u32,
    pub process: String,
    pub process_path: String,
    pub special_proxy: String,
    pub special_rules: String,
    pub remote_destination: String,
    pub dscp: u8,
    pub sniff_host: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Traffic {
    #[ts(type = "number")]
    pub up: u64,
    #[ts(type = "number")]
    pub down: u64,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Memory {
    pub inuse: u32,
    pub oslimit: u32,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Log {
    #[serde(rename = "type")]
    pub log_type: String,
    pub payload: String,
}

// ------------- use in rust, no need export to typescript -----------------
#[derive(Deserialize, Serialize)]
pub struct ErrorResponse {
    pub message: String,
}

#[derive(Deserialize, Serialize)]
pub struct CloseFrame {
    pub code: u16,
    pub reason: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum WebSocketMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<CloseFrame>),
}

pub type ConnectionId = u32;
pub enum WebSocketWriter {
    TcpStreamWriter(SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>),
    SocketStreamWriter(SplitSink<WebSocketStream<WrapStream>, Message>),
}

impl WebSocketWriter {
    pub async fn send(&mut self, message: Message) -> crate::Result<()> {
        match self {
            WebSocketWriter::TcpStreamWriter(write) => {
                write.send(message).await?;
            }
            WebSocketWriter::SocketStreamWriter(write) => {
                write.send(message).await?;
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct ConnectionManager(pub RwLock<HashMap<ConnectionId, WebSocketWriter>>);

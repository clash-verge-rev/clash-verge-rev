use serde::{Deserialize, Serialize};
use smartstring::alias::String;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct IGatewayMode {
    pub enabled: bool,
    pub lan_interface: String,
    pub gateway_address: String,
    pub dns_address: String,
    pub hijack_dns: bool,
    pub tun_was_enabled: bool,
    pub forwarding_was_enabled: bool,
    pub device_policies: Vec<IGatewayDevicePolicy>,
    pub devices: Vec<IGatewayDevice>,
    pub dhcp: IGatewayDhcpConfig,
}

impl Default for IGatewayMode {
    fn default() -> Self {
        Self {
            enabled: false,
            lan_interface: String::new(),
            gateway_address: String::new(),
            dns_address: "198.18.0.2".into(),
            hijack_dns: true,
            tun_was_enabled: false,
            forwarding_was_enabled: false,
            device_policies: Vec::new(),
            devices: Vec::new(),
            dhcp: IGatewayDhcpConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct IGatewayDhcpConfig {
    pub enabled: bool,
    pub pool_start: String,
    pub pool_end: String,
    pub subnet_mask: String,
    pub router: String,
    pub dns: String,
    pub lease_time_secs: u32,
}

impl Default for IGatewayDhcpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            pool_start: "192.168.50.100".into(),
            pool_end: "192.168.50.200".into(),
            subnet_mask: "255.255.255.0".into(),
            router: "192.168.50.1".into(),
            dns: "192.168.50.1".into(),
            lease_time_secs: 86400,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IGatewayDevicePolicy {
    pub source_ip: String,
    pub policy: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct IGatewayDevice {
    pub mac_address: String,
    pub name: String,
    pub icon: String,
    pub fixed_ip: String,
    pub last_ip: String,
    pub last_seen: u64,
    pub owner: String,
    pub group: String,
    pub notes: String,
    pub trusted: bool,
    pub internet_blocked: bool,
    pub blocked_domains: Vec<String>,
    pub blocked_ports: Vec<u16>,
}

impl Default for IGatewayDevice {
    fn default() -> Self {
        Self {
            mac_address: String::new(),
            name: String::new(),
            icon: "❓".into(),
            fixed_ip: String::new(),
            last_ip: String::new(),
            last_seen: 0,
            owner: String::new(),
            group: "unknown".into(),
            notes: String::new(),
            trusted: false,
            internet_blocked: false,
            blocked_domains: Vec::new(),
            blocked_ports: Vec::new(),
        }
    }
}

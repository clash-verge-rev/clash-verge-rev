use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::core::sysopt::Sysopt;
use crate::process::AsyncHandler;
use clash_verge_logging::{Type, logging};
use gethostname::gethostname;
use serde_yaml_ng::Mapping;
use std::net::TcpListener;
use sysproxy::{Autoproxy, Sysproxy};

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "异步获取系统代理配置");

    Sysopt::global().wait_idle().await;
    let sys_proxy = Sysproxy::get_system_proxy().stringify_err()?;
    let Sysproxy {
        ref host,
        ref bypass,
        ref port,
        ref enable,
    } = sys_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("server".into(), format!("{}:{}", host, port).into());
    map.insert("bypass".into(), bypass.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回系统代理配置: enable={}, {}:{}",
        sys_proxy.enable,
        sys_proxy.host,
        sys_proxy.port
    );
    Ok(map)
}

/// 获取自动代理配置
#[tauri::command]
pub async fn get_auto_proxy() -> CmdResult<Mapping> {
    Sysopt::global().wait_idle().await;
    let auto_proxy = Autoproxy::get_auto_proxy().stringify_err()?;
    let Autoproxy { ref enable, ref url } = auto_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("url".into(), url.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回自动代理配置（缓存）: enable={}, url={}",
        auto_proxy.enable,
        auto_proxy.url
    );
    Ok(map)
}

/// 获取系统主机名
#[tauri::command]
pub fn get_system_hostname() -> String {
    // 获取系统主机名，处理可能的非UTF-8字符
    match gethostname().into_string() {
        Ok(name) => name,
        Err(os_string) => {
            // 对于包含非UTF-8的主机名，使用调试格式化
            let fallback = format!("{os_string:?}");
            // 去掉可能存在的引号
            fallback.trim_matches('"').to_string()
        }
    }
}

/// 获取网络接口列表
#[tauri::command]
pub async fn get_network_interfaces() -> Vec<String> {
    AsyncHandler::spawn_blocking(|| {
        let mut networks = sysinfo::Networks::new();
        networks.refresh(false);
        networks.keys().map(|k| k.to_string()).collect()
    })
    .await
    .unwrap_or_default()
}

/// 获取网络接口详细信息
#[tauri::command]
pub async fn get_network_interfaces_info() -> CmdResult<Vec<serde_json::Value>> {
    let result = AsyncHandler::spawn_blocking(|| {
        let mut networks = sysinfo::Networks::new();
        networks.refresh(false);

        networks.iter().map(format_network_interface).collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();

    Ok(result)
}

/// 格式化 IP 网络地址
fn format_ip_network(ip_net: &sysinfo::IpNetwork) -> serde_json::Value {
    match ip_net.addr {
        std::net::IpAddr::V4(v4) => serde_json::json!({ "V4": { "ip": v4.to_string() } }),
        std::net::IpAddr::V6(v6) => serde_json::json!({ "V6": { "ip": v6.to_string() } }),
    }
}

/// 格式化单个网络接口信息
fn format_network_interface(item: (&String, &sysinfo::NetworkData)) -> serde_json::Value {
    let (name, network) = item;
    let addrs: Vec<_> = network.ip_networks().iter().map(format_ip_network).collect();

    let mac_addr = network.mac_address().to_string();
    let mac_addr_opt = (mac_addr != "00:00:00:00:00:00").then(|| mac_addr.replace('-', ":").to_uppercase());

    serde_json::json!({
        "name": name,
        "addr": addrs,
        "mac_addr": mac_addr_opt,
        "index": 0,
    })
}

#[tauri::command]
pub fn is_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

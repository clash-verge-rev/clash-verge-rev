use super::CmdResult;
use crate::cmd::StringifyErr as _;
use clash_verge_logging::{Type, logging};
use gethostname::gethostname;
use network_interface::NetworkInterface;
use serde_yaml_ng::Mapping;

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "异步获取系统代理配置");

    let sys_proxy = sysproxy::Sysproxy::get_system_proxy().stringify_err()?;

    let mut map = Mapping::new();
    map.insert("enable".into(), sys_proxy.enable.into());
    map.insert(
        "server".into(),
        format!("{}:{}", sys_proxy.host, sys_proxy.port).into(),
    );
    map.insert("bypass".into(), sys_proxy.bypass.into());

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
    let auto_proxy = sysproxy::Autoproxy::get_auto_proxy().stringify_err()?;

    let mut map = Mapping::new();
    map.insert("enable".into(), auto_proxy.enable.into());
    map.insert("url".into(), auto_proxy.url.clone().into());

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
pub fn get_network_interfaces() -> Vec<String> {
    use sysinfo::Networks;
    let mut result = Vec::new();
    let networks = Networks::new_with_refreshed_list();
    for (interface_name, _) in &networks {
        result.push(interface_name.clone());
    }
    result
}

/// 获取网络接口详细信息
#[tauri::command]
pub fn get_network_interfaces_info() -> CmdResult<Vec<NetworkInterface>> {
    use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};

    let names = get_network_interfaces();
    let interfaces = NetworkInterface::show().stringify_err()?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface);
        }
    }

    Ok(result)
}

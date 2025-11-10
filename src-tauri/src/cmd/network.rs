use super::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::core::{EventDrivenProxyManager, async_proxy_query::AsyncProxyQuery};
use crate::process::AsyncHandler;
use crate::{logging, utils::logging::Type};
use network_interface::NetworkInterface;
use serde_yaml_ng::Mapping;

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "异步获取系统代理配置");

    let current = AsyncProxyQuery::get_system_proxy().await;

    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert(
        "server".into(),
        format!("{}:{}", current.host, current.port).into(),
    );
    map.insert("bypass".into(), current.bypass.into());

    logging!(
        debug,
        Type::Network,
        "返回系统代理配置: enable={}, {}:{}",
        current.enable,
        current.host,
        current.port
    );
    Ok(map)
}

/// 获取自动代理配置
#[tauri::command]
pub async fn get_auto_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "开始获取自动代理配置（事件驱动）");

    let proxy_manager = EventDrivenProxyManager::global();

    let current = proxy_manager.get_auto_proxy_cached().await;
    // 异步请求更新，立即返回缓存数据
    AsyncHandler::spawn(move || async move {
        let _ = proxy_manager.get_auto_proxy_async().await;
    });

    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert("url".into(), current.url.clone().into());

    logging!(
        debug,
        Type::Network,
        "返回自动代理配置（缓存）: enable={}, url={}",
        current.enable,
        current.url
    );
    Ok(map)
}

/// 获取系统主机名
#[tauri::command]
pub fn get_system_hostname() -> CmdResult<String> {
    use gethostname::gethostname;

    // 获取系统主机名，处理可能的非UTF-8字符
    let hostname = match gethostname().into_string() {
        Ok(name) => name,
        Err(os_string) => {
            // 对于包含非UTF-8的主机名，使用调试格式化
            let fallback = format!("{os_string:?}");
            // 去掉可能存在的引号
            fallback.trim_matches('"').to_string()
        }
    };

    Ok(hostname)
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

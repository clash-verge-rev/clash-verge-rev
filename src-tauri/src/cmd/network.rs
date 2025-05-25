use super::CmdResult;
use crate::wrap_err;
use network_interface::NetworkInterface;
use serde_yaml::Mapping;
use sysproxy::{Autoproxy, Sysproxy};
use tokio::task::spawn_blocking;

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    let current = spawn_blocking(Sysproxy::get_system_proxy)
        .await
        .map_err(|e| format!("Failed to spawn blocking task for sysproxy: {}", e))?
        .map_err(|e| format!("Failed to get system proxy: {}", e))?;

    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert(
        "server".into(),
        format!("{}:{}", current.host, current.port).into(),
    );
    map.insert("bypass".into(), current.bypass.into());

    Ok(map)
}

/// get the system proxy
#[tauri::command]
pub async fn get_auto_proxy() -> CmdResult<Mapping> {
    let current = spawn_blocking(Autoproxy::get_auto_proxy)
        .await
        .map_err(|e| format!("Failed to spawn blocking task for autoproxy: {}", e))?
        .map_err(|e| format!("Failed to get auto proxy: {}", e))?;

    let mut map = Mapping::new();
    map.insert("enable".into(), current.enable.into());
    map.insert("url".into(), current.url.into());

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
            let fallback = format!("{:?}", os_string);
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
    use network_interface::{NetworkInterface, NetworkInterfaceConfig};

    let names = get_network_interfaces();
    let interfaces = wrap_err!(NetworkInterface::show())?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface);
        }
    }

    Ok(result)
}

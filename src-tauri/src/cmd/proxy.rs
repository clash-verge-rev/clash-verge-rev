use super::CmdResult;
use clash_verge_logging::{Type, logging};

// TODO: 前端通过 emit 发送更新事件, tray 监听更新事件
/// 同步托盘和GUI的代理选择状态
#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    use crate::core::tray::Tray;

    match Tray::global().update_menu().await {
        Ok(_) => {
            logging!(info, Type::Cmd, "Tray proxy selection synced successfully");
            Ok(())
        }
        Err(e) => {
            logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e}");
            Err(e.to_string().into())
        }
    }
}

/// 测试所有节点延迟
#[tauri::command]
pub async fn test_all_nodes() -> CmdResult<()> {
    use crate::cmd::StringifyErr as _;
    use crate::core::handle;
    use crate::core::tray::Tray;

    logging!(info, Type::Cmd, "Starting node delay test from tray");

    // 设置测试状态并更新菜单
    Tray::global().set_node_testing(true);
    let _ = Tray::global().update_menu().await;

    // 获取所有代理组
    let proxies = match handle::Handle::mihomo()
        .await
        .get_proxies()
        .await
        .stringify_err()
    {
        Ok(p) => p,
        Err(e) => {
            Tray::global().set_node_testing(false);
            let _ = Tray::global().update_menu().await;
            return Err(e);
        }
    };

    // 获取默认测试URL和超时时间
    let url = "https://cp.cloudflare.com/generate_204";
    let timeout = {
        use crate::config::Config;
        let verge = Config::verge().await;
        let verge_data = verge.latest_arc();
        verge_data
            .default_latency_timeout
            .map(|t| t as u32)
            .unwrap_or(10000)
    };

    logging!(
        info,
        Type::Cmd,
        "Testing {} proxy groups with URL: {}, timeout: {}ms",
        proxies.proxies.len(),
        url,
        timeout
    );

    // 对每个代理组进行延迟测试
    for (group_name, group_data) in proxies.proxies.iter() {
        // 跳过隐藏的组和没有节点的组
        if group_data.hidden.unwrap_or(false) || group_data.all.is_none() {
            continue;
        }

        logging!(debug, Type::Cmd, "Testing group: {}", group_name);

        // 使用 mihomo API 测试组延迟
        if let Err(e) = handle::Handle::mihomo()
            .await
            .delay_group(group_name, url, timeout)
            .await
        {
            logging!(
                warn,
                Type::Cmd,
                "Failed to test delay for group {}: {}",
                group_name,
                e
            );
        }
    }

    // 恢复测试状态并更新菜单
    Tray::global().set_node_testing(false);
    let _ = Tray::global().update_menu().await;

    logging!(info, Type::Cmd, "Node delay test completed");
    Ok(())
}

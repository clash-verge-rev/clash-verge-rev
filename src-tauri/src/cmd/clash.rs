use super::CmdResult;
use crate::{
    config::*,
    core::*,
    feat,
    ipc::{self, IpcManager},
    process::AsyncHandler,
    state::proxy::ProxyRequestCache,
    wrap_err,
};
use serde_yaml::Mapping;
use std::time::Duration;

const CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// 复制Clash环境变量
#[tauri::command]
pub fn copy_clash_env() -> CmdResult {
    feat::copy_clash_env();
    Ok(())
}

/// 获取Clash信息
#[tauri::command]
pub fn get_clash_info() -> CmdResult<ClashInfo> {
    Ok(Config::clash().latest_ref().get_client_info())
}

/// 修改Clash配置
#[tauri::command]
pub async fn patch_clash_config(payload: Mapping) -> CmdResult {
    wrap_err!(feat::patch_clash(payload).await)
}

/// 修改Clash模式
#[tauri::command]
pub async fn patch_clash_mode(payload: String) -> CmdResult {
    feat::change_clash_mode(payload);
    Ok(())
}

/// 切换Clash核心
#[tauri::command]
pub async fn change_clash_core(clash_core: String) -> CmdResult<Option<String>> {
    log::info!(target: "app", "changing core to {clash_core}");

    match CoreManager::global()
        .change_core(Some(clash_core.clone()))
        .await
    {
        Ok(_) => {
            // 切换内核后重启内核
            match CoreManager::global().restart_core().await {
                Ok(_) => {
                    log::info!(target: "app", "core changed and restarted to {clash_core}");
                    handle::Handle::notice_message("config_core::change_success", &clash_core);
                    handle::Handle::refresh_clash();
                    Ok(None)
                }
                Err(err) => {
                    let error_msg = format!("Core changed but failed to restart: {err}");
                    log::error!(target: "app", "{error_msg}");
                    handle::Handle::notice_message("config_core::change_error", &error_msg);
                    Ok(Some(error_msg))
                }
            }
        }
        Err(err) => {
            let error_msg = err.to_string();
            log::error!(target: "app", "failed to change core: {error_msg}");
            handle::Handle::notice_message("config_core::change_error", &error_msg);
            Ok(Some(error_msg))
        }
    }
}

/// 启动核心
#[tauri::command]
pub async fn start_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().start_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 关闭核心
#[tauri::command]
pub async fn stop_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().stop_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 重启核心
#[tauri::command]
pub async fn restart_core() -> CmdResult {
    let result = wrap_err!(CoreManager::global().restart_core().await);
    if result.is_ok() {
        handle::Handle::refresh_clash();
    }
    result
}

/// 获取代理延迟
#[tauri::command]
pub async fn clash_api_get_proxy_delay(
    name: String,
    url: Option<String>,
    timeout: i32,
) -> CmdResult<serde_json::Value> {
    wrap_err!(
        IpcManager::global()
            .test_proxy_delay(&name, url, timeout)
            .await
    )
}

/// 测试URL延迟
#[tauri::command]
pub async fn test_delay(url: String) -> CmdResult<u32> {
    Ok(feat::test_delay(url).await.unwrap_or(10000u32))
}

/// 保存DNS配置到单独文件
#[tauri::command]
pub async fn save_dns_config(dns_config: Mapping) -> CmdResult {
    use crate::utils::dirs;
    use serde_yaml;
    use std::fs;

    // 获取DNS配置文件路径
    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    // 保存DNS配置到文件
    let yaml_str = serde_yaml::to_string(&dns_config).map_err(|e| e.to_string())?;
    fs::write(&dns_path, yaml_str).map_err(|e| e.to_string())?;
    log::info!(target: "app", "DNS config saved to {dns_path:?}");

    Ok(())
}

/// 应用或撤销DNS配置
#[tauri::command]
pub fn apply_dns_config(apply: bool) -> CmdResult {
    use crate::{
        config::Config,
        core::{handle, CoreManager},
        utils::dirs,
    };

    // 使用spawn来处理异步操作
    AsyncHandler::spawn(move || async move {
        if apply {
            // 读取DNS配置文件
            let dns_path = match dirs::app_home_dir() {
                Ok(path) => path.join("dns_config.yaml"),
                Err(e) => {
                    log::error!(target: "app", "Failed to get home dir: {e}");
                    return;
                }
            };

            if !dns_path.exists() {
                log::warn!(target: "app", "DNS config file not found");
                return;
            }

            let dns_yaml = match std::fs::read_to_string(&dns_path) {
                Ok(content) => content,
                Err(e) => {
                    log::error!(target: "app", "Failed to read DNS config: {e}");
                    return;
                }
            };

            // 解析DNS配置并创建patch
            let patch_config = match serde_yaml::from_str::<serde_yaml::Mapping>(&dns_yaml) {
                Ok(config) => {
                    let mut patch = serde_yaml::Mapping::new();
                    patch.insert("dns".into(), config.into());
                    patch
                }
                Err(e) => {
                    log::error!(target: "app", "Failed to parse DNS config: {e}");
                    return;
                }
            };

            log::info!(target: "app", "Applying DNS config from file");

            // 重新生成配置，确保DNS配置被正确应用
            // 这里不调用patch_clash以避免将DNS配置写入config.yaml
            Config::runtime()
                .draft_mut()
                .patch_config(patch_config.clone());

            // 首先重新生成配置
            if let Err(err) = Config::generate().await {
                log::error!(target: "app", "Failed to regenerate config with DNS: {err}");
                return;
            }

            // 然后应用新配置
            if let Err(err) = CoreManager::global().update_config().await {
                log::error!(target: "app", "Failed to apply config with DNS: {err}");
            } else {
                log::info!(target: "app", "DNS config successfully applied");
                handle::Handle::refresh_clash();
            }
        } else {
            // 当关闭DNS设置时，不需要对配置进行任何修改
            // 直接重新生成配置，让enhance函数自动跳过DNS配置的加载
            log::info!(target: "app", "DNS settings disabled, regenerating config");

            // 重新生成配置
            if let Err(err) = Config::generate().await {
                log::error!(target: "app", "Failed to regenerate config: {err}");
                return;
            }

            // 应用新配置
            match CoreManager::global().update_config().await {
                Ok(_) => {
                    log::info!(target: "app", "Config regenerated successfully");
                    handle::Handle::refresh_clash();
                }
                Err(err) => {
                    log::error!(target: "app", "Failed to apply regenerated config: {err}");
                }
            }
        }
    });

    Ok(())
}

/// 检查DNS配置文件是否存在
#[tauri::command]
pub fn check_dns_config_exists() -> CmdResult<bool> {
    use crate::utils::dirs;

    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    Ok(dns_path.exists())
}

/// 获取DNS配置文件内容
#[tauri::command]
pub async fn get_dns_config_content() -> CmdResult<String> {
    use crate::utils::dirs;
    use std::fs;

    let dns_path = dirs::app_home_dir()
        .map_err(|e| e.to_string())?
        .join("dns_config.yaml");

    if !dns_path.exists() {
        return Err("DNS config file not found".into());
    }

    let content = fs::read_to_string(&dns_path).map_err(|e| e.to_string())?;
    Ok(content)
}

/// 验证DNS配置文件
#[tauri::command]
pub async fn validate_dns_config() -> CmdResult<(bool, String)> {
    use crate::{core::CoreManager, utils::dirs};

    let app_dir = dirs::app_home_dir().map_err(|e| e.to_string())?;
    let dns_path = app_dir.join("dns_config.yaml");
    let dns_path_str = dns_path.to_str().unwrap_or_default();

    if !dns_path.exists() {
        return Ok((false, "DNS config file not found".to_string()));
    }

    match CoreManager::global()
        .validate_config_file(dns_path_str, None)
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => Err(e.to_string()),
    }
}

/// 获取Clash版本信息
#[tauri::command]
pub async fn get_clash_version() -> CmdResult<serde_json::Value> {
    wrap_err!(IpcManager::global().get_version().await)
}

/// 获取Clash配置
#[tauri::command]
pub async fn get_clash_config() -> CmdResult<serde_json::Value> {
    let manager = IpcManager::global();
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("clash_config", "default");
    let value = cache
        .get_or_fetch(key, CONFIG_REFRESH_INTERVAL, || async {
            manager.get_config().await.expect("fetch failed")
        })
        .await;
    Ok((*value).clone())
}

/// 强制刷新Clash配置缓存
#[tauri::command]
pub async fn force_refresh_clash_config() -> CmdResult<serde_json::Value> {
    let cache = ProxyRequestCache::global();
    let key = ProxyRequestCache::make_key("clash_config", "default");
    cache.map.remove(&key);
    get_clash_config().await
}

/// 更新地理数据
#[tauri::command]
pub async fn update_geo_data() -> CmdResult {
    wrap_err!(IpcManager::global().update_geo_data().await)
}

/// 升级Clash核心
#[tauri::command]
pub async fn upgrade_clash_core() -> CmdResult {
    wrap_err!(IpcManager::global().upgrade_core().await)
}

/// 获取规则
#[tauri::command]
pub async fn get_clash_rules() -> CmdResult<serde_json::Value> {
    wrap_err!(IpcManager::global().get_rules().await)
}

/// 更新代理选择
#[tauri::command]
pub async fn update_proxy_choice(group: String, proxy: String) -> CmdResult {
    wrap_err!(IpcManager::global().update_proxy(&group, &proxy).await)
}

/// 获取代理提供者
#[tauri::command]
pub async fn get_proxy_providers() -> CmdResult<serde_json::Value> {
    wrap_err!(IpcManager::global().get_providers_proxies().await)
}

/// 获取规则提供者
#[tauri::command]
pub async fn get_rule_providers() -> CmdResult<serde_json::Value> {
    wrap_err!(IpcManager::global().get_rule_providers().await)
}

/// 代理提供者健康检查
#[tauri::command]
pub async fn proxy_provider_health_check(name: String) -> CmdResult {
    wrap_err!(
        IpcManager::global()
            .proxy_provider_health_check(&name)
            .await
    )
}

/// 更新代理提供者
#[tauri::command]
pub async fn update_proxy_provider(name: String) -> CmdResult {
    wrap_err!(IpcManager::global().update_proxy_provider(&name).await)
}

/// 更新规则提供者
#[tauri::command]
pub async fn update_rule_provider(name: String) -> CmdResult {
    wrap_err!(IpcManager::global().update_rule_provider(&name).await)
}

/// 获取连接
#[tauri::command]
pub async fn get_clash_connections() -> CmdResult<serde_json::Value> {
    wrap_err!(IpcManager::global().get_connections().await)
}

/// 删除连接
#[tauri::command]
pub async fn delete_clash_connection(id: String) -> CmdResult {
    wrap_err!(IpcManager::global().delete_connection(&id).await)
}

/// 关闭所有连接
#[tauri::command]
pub async fn close_all_clash_connections() -> CmdResult {
    wrap_err!(IpcManager::global().close_all_connections().await)
}

/// 获取流量数据 (使用新的IPC流式监控)
#[tauri::command]
pub async fn get_traffic_data() -> CmdResult<serde_json::Value> {
    log::info!(target: "app", "开始获取流量数据 (IPC流式)");
    let traffic = crate::ipc::get_current_traffic().await;
    let result = serde_json::json!({
        "up": traffic.total_up,
        "down": traffic.total_down,
        "up_rate": traffic.up_rate,
        "down_rate": traffic.down_rate,
        "last_updated": traffic.last_updated.elapsed().as_secs()
    });
    log::info!(target: "app", "获取流量数据结果: up={}, down={}, up_rate={}, down_rate={}", 
        traffic.total_up, traffic.total_down, traffic.up_rate, traffic.down_rate);
    Ok(result)
}

/// 获取内存数据 (使用新的IPC流式监控)
#[tauri::command]
pub async fn get_memory_data() -> CmdResult<serde_json::Value> {
    log::info!(target: "app", "开始获取内存数据 (IPC流式)");
    let memory = crate::ipc::get_current_memory().await;
    let usage_percent = if memory.oslimit > 0 {
        (memory.inuse as f64 / memory.oslimit as f64) * 100.0
    } else {
        0.0
    };
    let result = serde_json::json!({
        "inuse": memory.inuse,
        "oslimit": memory.oslimit,
        "usage_percent": usage_percent,
        "last_updated": memory.last_updated.elapsed().as_secs()
    });
    log::info!(target: "app", "获取内存数据结果: inuse={}, oslimit={}, usage={}%", 
        memory.inuse, memory.oslimit, usage_percent);
    Ok(result)
}

/// 启动流量监控服务 (IPC流式监控自动启动，此函数为兼容性保留)
#[tauri::command]
pub async fn start_traffic_service() -> CmdResult {
    log::info!(target: "app", "启动流量监控服务 (IPC流式监控)");
    // 新的IPC监控在首次访问时自动启动
    // 触发一次访问以确保监控器已初始化
    let _ = crate::ipc::get_current_traffic().await;
    let _ = crate::ipc::get_current_memory().await;
    log::info!(target: "app", "IPC流式监控已激活");
    Ok(())
}

/// 停止流量监控服务 (IPC流式监控无需显式停止，此函数为兼容性保留)
#[tauri::command]
pub async fn stop_traffic_service() -> CmdResult {
    log::info!(target: "app", "停止流量监控服务请求 (IPC流式监控)");
    // 新的IPC监控是持久的，无需显式停止
    log::info!(target: "app", "IPC流式监控继续运行");
    Ok(())
}

/// 获取格式化的流量数据 (包含单位，便于前端显示)
#[tauri::command]
pub async fn get_formatted_traffic_data() -> CmdResult<serde_json::Value> {
    log::info!(target: "app", "获取格式化流量数据");
    let (up_rate, down_rate, total_up, total_down, is_fresh) =
        crate::ipc::get_formatted_traffic().await;
    let result = serde_json::json!({
        "up_rate_formatted": up_rate,
        "down_rate_formatted": down_rate,
        "total_up_formatted": total_up,
        "total_down_formatted": total_down,
        "is_fresh": is_fresh
    });
    log::debug!(target: "app", "格式化流量数据: ↑{up_rate}/s ↓{down_rate}/s (总计: ↑{total_up} ↓{total_down})");
    // Clippy: variables can be used directly in the format string
    // log::debug!(target: "app", "格式化流量数据: ↑{up_rate}/s ↓{down_rate}/s (总计: ↑{total_up} ↓{total_down})");
    Ok(result)
}

/// 获取格式化的内存数据 (包含单位，便于前端显示)
#[tauri::command]
pub async fn get_formatted_memory_data() -> CmdResult<serde_json::Value> {
    log::info!(target: "app", "获取格式化内存数据");
    let (inuse, oslimit, usage_percent, is_fresh) = crate::ipc::get_formatted_memory().await;
    let result = serde_json::json!({
        "inuse_formatted": inuse,
        "oslimit_formatted": oslimit,
        "usage_percent": usage_percent,
        "is_fresh": is_fresh
    });
    log::debug!(target: "app", "格式化内存数据: {inuse} / {oslimit} ({usage_percent:.1}%)");
    // Clippy: variables can be used directly in the format string
    // log::debug!(target: "app", "格式化内存数据: {inuse} / {oslimit} ({usage_percent:.1}%)");
    Ok(result)
}

/// 获取系统监控概览 (流量+内存，便于前端一次性获取所有状态)
#[tauri::command]
pub async fn get_system_monitor_overview() -> CmdResult<serde_json::Value> {
    log::debug!(target: "app", "获取系统监控概览");

    // 并发获取流量和内存数据
    let (traffic, memory) = tokio::join!(
        crate::ipc::get_current_traffic(),
        crate::ipc::get_current_memory()
    );

    let (traffic_formatted, memory_formatted) = tokio::join!(
        crate::ipc::get_formatted_traffic(),
        crate::ipc::get_formatted_memory()
    );

    let traffic_is_fresh = traffic.last_updated.elapsed().as_secs() < 5;
    let memory_is_fresh = memory.last_updated.elapsed().as_secs() < 10;

    let result = serde_json::json!({
        "traffic": {
            "raw": {
                "up": traffic.total_up,
                "down": traffic.total_down,
                "up_rate": traffic.up_rate,
                "down_rate": traffic.down_rate
            },
            "formatted": {
                "up_rate": traffic_formatted.0,
                "down_rate": traffic_formatted.1,
                "total_up": traffic_formatted.2,
                "total_down": traffic_formatted.3
            },
            "is_fresh": traffic_is_fresh
        },
        "memory": {
            "raw": {
                "inuse": memory.inuse,
                "oslimit": memory.oslimit,
                "usage_percent": if memory.oslimit > 0 {
                    (memory.inuse as f64 / memory.oslimit as f64) * 100.0
                } else {
                    0.0
                }
            },
            "formatted": {
                "inuse": memory_formatted.0,
                "oslimit": memory_formatted.1,
                "usage_percent": memory_formatted.2
            },
            "is_fresh": memory_is_fresh
        },
        "overall_status": if traffic_is_fresh && memory_is_fresh { "healthy" } else { "stale" }
    });

    Ok(result)
}

/// 获取代理组延迟
#[tauri::command]
pub async fn get_group_proxy_delays(
    group_name: String,
    url: Option<String>,
    timeout: Option<i32>,
) -> CmdResult<serde_json::Value> {
    wrap_err!(
        IpcManager::global()
            .get_group_proxy_delays(&group_name, url, timeout.unwrap_or(10000))
            .await
    )
}

/// 检查调试是否启用
#[tauri::command]
pub async fn is_clash_debug_enabled() -> CmdResult<bool> {
    match IpcManager::global().is_debug_enabled().await {
        Ok(enabled) => Ok(enabled),
        Err(_) => Ok(false),
    }
}

/// 垃圾回收
#[tauri::command]
pub async fn clash_gc() -> CmdResult {
    wrap_err!(IpcManager::global().gc().await)
}

/// 获取日志 (使用新的流式实现)
#[tauri::command]
pub async fn get_clash_logs(level: Option<String>) -> CmdResult<serde_json::Value> {
    Ok(ipc::get_logs_json(level).await)
}

/// 启动日志监控
#[tauri::command]
pub async fn start_logs_monitoring(level: Option<String>) -> CmdResult {
    ipc::start_logs_monitoring(level).await;
    Ok(())
}

/// 停止日志监控
#[tauri::command]
pub async fn stop_logs_monitoring() -> CmdResult {
    ipc::stop_logs_monitoring().await;
    Ok(())
}

/// 清除日志
#[tauri::command]
pub async fn clear_logs() -> CmdResult {
    ipc::clear_logs().await;
    Ok(())
}

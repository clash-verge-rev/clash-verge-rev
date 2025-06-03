use super::CmdResult;
use crate::module::mihomo::MihomoManager;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

static LAST_REFRESH_TIME: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));
static IS_REFRESHING: AtomicBool = AtomicBool::new(false);
const REFRESH_INTERVAL: Duration = Duration::from_secs(5);

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let manager = MihomoManager::global();

    manager
        .refresh_proxies()
        .await
        .map(|_| manager.get_proxies())
        .or_else(|_| Ok(manager.get_proxies()))
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let manager = MihomoManager::global();
    let cached_data = manager.get_providers_proxies();

    // 检查缓存数据是否有效
    let providers = cached_data
        .as_object()
        .and_then(|obj| obj.get("providers"))
        .and_then(|p| p.as_object())
        .map(|p| !p.is_empty())
        .unwrap_or(false);

    // 检查缓存数据是否包含proxies字段
    let has_proxies = cached_data
        .as_object()
        .and_then(|obj| obj.get("proxies"))
        .is_some();

    let should_refresh = {
        let last_refresh = LAST_REFRESH_TIME.lock();
        match *last_refresh {
            Some(last_time) => last_time.elapsed() > REFRESH_INTERVAL,
            None => true,
        }
    };

    // 无缓存或缓存中providers为空，立即刷新并等待
    if !providers || !has_proxies || (should_refresh && !IS_REFRESHING.load(Ordering::Acquire)) {
        // 加锁防止多个请求同时刷新
        if IS_REFRESHING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_ok()
        {
            log::info!(target: "app", "providers_proxies缓存无效，主动刷新");

            match manager.refresh_providers_proxies().await {
                Ok(_) => {
                    log::info!(target: "app", "providers_proxies主动刷新成功");
                    let updated_data = manager.get_providers_proxies();

                    // 更新最后刷新时间
                    *LAST_REFRESH_TIME.lock() = Some(Instant::now());
                    IS_REFRESHING.store(false, Ordering::Release);

                    // 返回最新数据
                    return Ok(updated_data);
                }
                Err(e) => {
                    log::error!(target: "app", "providers_proxies主动刷新失败: {}", e);
                    IS_REFRESHING.store(false, Ordering::Release);
                }
            }
        }
    }

    // 使用现有缓存数据（确保包含proxies字段）
    let safe_data = if cached_data.is_null() || !providers || !has_proxies {
        log::warn!(target: "app", "providers_proxies数据不完整，返回默认结构");
        serde_json::json!({
            "providers": {},
            "proxies": {}
        })
    } else {
        cached_data
    };

    // 后台异步刷新（缓存存在但已过期）
    if should_refresh && !IS_REFRESHING.load(Ordering::Acquire) {
        IS_REFRESHING.store(true, Ordering::Release);

        crate::process::AsyncHandler::spawn(|| async move {
            let manager = MihomoManager::global();
            match manager.refresh_providers_proxies().await {
                Ok(_) => {
                    log::debug!(target: "app", "providers_proxies静默后台刷新成功");
                }
                Err(e) => {
                    log::error!(target: "app", "providers_proxies后台刷新失败: {}", e);
                }
            }

            {
                let mut last_refresh = LAST_REFRESH_TIME.lock();
                *last_refresh = Some(Instant::now());
            }

            IS_REFRESHING.store(false, Ordering::Release);
        });
    }

    Ok(safe_data)
}

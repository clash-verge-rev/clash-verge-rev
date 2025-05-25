use super::CmdResult;
use crate::{core::handle, module::mihomo::MihomoManager};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static LAST_REFRESH_TIME: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));
static LAST_EVENT_TIME: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));
static IS_REFRESHING: AtomicBool = AtomicBool::new(false);
const REFRESH_INTERVAL: Duration = Duration::from_secs(3);
const EVENT_INTERVAL: Duration = Duration::from_secs(1);

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

    let safe_data = if cached_data.is_null() {
        serde_json::json!({
            "providers": {}
        })
    } else {
        cached_data
    };

    // 检查是否需要刷新
    let should_refresh = {
        let last_refresh = LAST_REFRESH_TIME.lock();
        match *last_refresh {
            Some(last_time) => last_time.elapsed() > REFRESH_INTERVAL,
            None => true,
        }
    };

    if should_refresh && !IS_REFRESHING.load(Ordering::Acquire) {
        IS_REFRESHING.store(true, Ordering::Release);

        crate::process::AsyncHandler::spawn(|| async move {
            let manager = MihomoManager::global();
            match manager.refresh_providers_proxies().await {
                Ok(_) => {
                    log::debug!(target: "app", "providers_proxies后台刷新成功");

                    let should_send_event = {
                        let mut last_event = LAST_EVENT_TIME.lock();
                        match *last_event {
                            Some(last_time) => {
                                if last_time.elapsed() > EVENT_INTERVAL {
                                    *last_event = Some(Instant::now());
                                    true
                                } else {
                                    false
                                }
                            }
                            None => {
                                *last_event = Some(Instant::now());
                                true
                            }
                        }
                    };
                    if should_send_event {
                        handle::Handle::refresh_providers_proxies();
                        log::debug!(target: "app", "已发送providers_proxies刷新事件");
                    } else {
                        log::debug!(target: "app", "跳过providers_proxies事件发送（频率限制）");
                    }
                }
                Err(e) => {
                    log::warn!(target: "app", "providers_proxies后台刷新失败: {}", e);
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

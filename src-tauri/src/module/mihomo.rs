use crate::config::Config;
use mihomo_api;
use once_cell::sync::Lazy;
use parking_lot::{Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::http::HeaderMap;

// 缓存的最大有效期（5秒）
const CACHE_TTL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rate {
    pub up: u64,
    pub down: u64,
}
// 缓存MihomoManager实例
struct MihomoCache {
    manager: mihomo_api::MihomoManager,
    created_at: Instant,
    server: String,
}
// 使用RwLock替代Mutex，允许多个读取操作并发进行
pub struct MihomoManager {
    mihomo_cache: RwLock<Option<MihomoCache>>,
    create_lock: Mutex<()>,
}

impl MihomoManager {
    fn __global() -> &'static MihomoManager {
        static INSTANCE: Lazy<MihomoManager> = Lazy::new(|| MihomoManager {
            mihomo_cache: RwLock::new(None),
            create_lock: Mutex::new(()),
        });
        &INSTANCE
    }

    pub fn global() -> mihomo_api::MihomoManager {
        let instance = MihomoManager::__global();

        // 尝试从缓存读取（只需读锁）
        {
            let cache = instance.mihomo_cache.read();
            if let Some(cache_entry) = &*cache {
                let (current_server, _) = MihomoManager::get_clash_client_info()
                    .unwrap_or_else(|| (String::new(), HeaderMap::new()));

                // 检查缓存是否有效
                if cache_entry.server == current_server
                    && cache_entry.created_at.elapsed() < CACHE_TTL
                {
                    return cache_entry.manager.clone();
                }
            }
        }

        // 缓存无效，获取创建锁
        let _create_guard = instance.create_lock.lock();

        // 再次检查缓存（双重检查锁定模式）
        {
            let cache = instance.mihomo_cache.read();
            if let Some(cache_entry) = &*cache {
                let (current_server, _) = MihomoManager::get_clash_client_info()
                    .unwrap_or_else(|| (String::new(), HeaderMap::new()));

                if cache_entry.server == current_server
                    && cache_entry.created_at.elapsed() < CACHE_TTL
                {
                    return cache_entry.manager.clone();
                }
            }
        }

        // 创建新实例
        let (current_server, headers) = MihomoManager::get_clash_client_info()
            .unwrap_or_else(|| (String::new(), HeaderMap::new()));
        let manager = mihomo_api::MihomoManager::new(current_server.clone(), headers);

        // 更新缓存
        {
            let mut cache = instance.mihomo_cache.write();
            *cache = Some(MihomoCache {
                manager: manager.clone(),
                created_at: Instant::now(),
                server: current_server,
            });
        }

        manager
    }
}

impl MihomoManager {
    pub fn get_clash_client_info() -> Option<(String, HeaderMap)> {
        let client = { Config::clash().latest_ref().get_client_info() };
        let server = format!("http://{}", client.server);
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse().unwrap());
        if let Some(secret) = client.secret {
            let secret = format!("Bearer {secret}").parse().unwrap();
            headers.insert("Authorization", secret);
        }

        Some((server, headers))
    }

    // 已移除未使用的 get_clash_client_info_or_default 和 get_traffic_ws_url 方法
}

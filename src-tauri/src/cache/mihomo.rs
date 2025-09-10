use std::{sync::Arc, time::Duration};

use moka::future::CacheBuilder;
use once_cell::sync::Lazy;
use serde_json::Value;

use super::RefreshableCache;

pub const CACHE_PROXIES_KEY: &str = "proxies";
pub const CACHE_PROVIDERS_KEY: &str = "providers";
pub const CACHE_CONFIG_KEY: &str = "config";

pub static MIHOMO_CACHE: Lazy<Arc<RefreshableCache<String, Value>>> = Lazy::new(|| {
    Arc::new(RefreshableCache::new(
        CacheBuilder::new(3)
            .name("mihomo")
            .time_to_live(Duration::from_secs(60))
            .time_to_idle(Duration::from_secs(60))
            .build(),
    ))
});

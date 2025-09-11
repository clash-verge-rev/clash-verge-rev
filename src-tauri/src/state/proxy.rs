// use crate::utils::logging::Type;
// use crate::{logging, singleton};
use crate::singleton;
use dashmap::DashMap;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;

pub struct CacheEntry {
    pub value: Arc<Value>,
    pub expires_at: Instant,
}

pub struct ProxyRequestCache {
    pub map: DashMap<String, Arc<OnceCell<Box<CacheEntry>>>>,
}

impl ProxyRequestCache {
    fn new() -> Self {
        ProxyRequestCache {
            map: DashMap::new(),
        }
    }

    pub fn make_key(prefix: &str, id: &str) -> String {
        format!("{prefix}:{id}")
    }

    pub async fn get_or_fetch<F, Fut>(&self, key: String, ttl: Duration, fetch_fn: F) -> Arc<Value>
    where
        F: Fn() -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Value> + Send + 'static,
    {
        loop {
            let now = Instant::now();
            let key_cloned = key.clone();

            // Get or create the cell
            let cell = self
                .map
                .entry(key_cloned.clone())
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone();

            // Check if we have a valid cached entry
            if let Some(entry) = cell.get() {
                if entry.expires_at > now {
                    return Arc::clone(&entry.value);
                }
                // Entry is expired, remove it
                self.map
                    .remove_if(&key_cloned, |_, v| Arc::ptr_eq(v, &cell));
                continue; // Retry with fresh cell
            }

            // Try to set a new value
            let value = fetch_fn().await;
            let entry = Box::new(CacheEntry {
                value: Arc::new(value),
                expires_at: Instant::now() + ttl,
            });

            match cell.set(entry) {
                Ok(_) => {
                    // Successfully set the value, it must exist now
                    if let Some(set_entry) = cell.get() {
                        return Arc::clone(&set_entry.value);
                    }
                }
                Err(_) => {
                    if let Some(existing_entry) = cell.get() {
                        if existing_entry.expires_at > Instant::now() {
                            return Arc::clone(&existing_entry.value);
                        }
                        self.map
                            .remove_if(&key_cloned, |_, v| Arc::ptr_eq(v, &cell));
                    }
                }
            }
        }
    }

    // TODO
    pub fn clean_default_keys(&self) {
        // logging!(info, Type::Cache, "Cleaning proxies keys");
        // let proxies_key = Self::make_key("proxies", "default");
        // self.map.remove(&proxies_key);

        // logging!(info, Type::Cache, "Cleaning providers keys");
        // let providers_key = Self::make_key("providers", "default");
        // self.map.remove(&providers_key);

        // !The frontend goes crash if we clean the clash_config cache
        // logging!(info, Type::Cache, "Cleaning clash config keys");
        // let clash_config_key = Self::make_key("clash_config", "default");
        // self.map.remove(&clash_config_key);
    }
}

// Use singleton macro
singleton!(ProxyRequestCache, INSTANCE);

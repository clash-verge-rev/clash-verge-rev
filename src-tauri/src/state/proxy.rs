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
    pub map: DashMap<String, Arc<OnceCell<CacheEntry>>>,
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
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Value>,
    {
        let now = Instant::now();
        let key_cloned = key.clone();
        let cell = self
            .map
            .entry(key)
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone();

        if let Some(entry) = cell.get() {
            if entry.expires_at > now {
                return Arc::clone(&entry.value);
            }
        }

        if let Some(entry) = cell.get() {
            if entry.expires_at <= now {
                self.map
                    .remove_if(&key_cloned, |_, v| Arc::ptr_eq(v, &cell));
                let new_cell = Arc::new(OnceCell::new());
                self.map.insert(key_cloned.clone(), new_cell.clone());
                return Box::pin(self.get_or_fetch(key_cloned, ttl, fetch_fn)).await;
            }
        }

        let value = fetch_fn().await;
        let entry = CacheEntry {
            value: Arc::new(value),
            expires_at: Instant::now() + ttl,
        };
        let _ = cell.set(entry);
        Arc::clone(&cell.get().unwrap().value)
    }
}

// Use singleton macro
singleton!(ProxyRequestCache, INSTANCE);

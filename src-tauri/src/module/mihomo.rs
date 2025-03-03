use crate::model::api::mihomo::MihomoAPICaller;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use std::sync::Arc;

#[allow(unused)]
pub struct MihomoManager {
    proxies: serde_json::Value,
    providers_proxies: serde_json::Value,
}

#[allow(unused)]
impl MihomoManager {
    pub fn new() -> Arc<RwLock<Self>> {
        static INSTANCE: OnceCell<Arc<RwLock<MihomoManager>>> = OnceCell::new();
        INSTANCE
            .get_or_init(|| {
                Arc::new(RwLock::new(MihomoManager {
                    proxies: serde_json::Value::Null,
                    providers_proxies: serde_json::Value::Null,
                }))
            })
            .clone()
    }

    pub fn fetch_proxies(&self) -> &serde_json::Value {
        &self.proxies
    }

    pub fn fetch_providers_proxies(&self) -> &serde_json::Value {
        &self.providers_proxies
    }

    pub async fn refresh_proxies(&mut self) {
        match MihomoAPICaller::get_proxies().await {
            Ok(proxies) => {
                self.proxies = proxies;
            }
            Err(e) => {
                log::error!("Failed to get proxies: {}", e);
            }
        }
    }

    pub async fn refresh_providers_proxies(&mut self) {
        match MihomoAPICaller::get_providers_proxies().await {
            Ok(providers_proxies) => {
                self.providers_proxies = providers_proxies;
            },
            Err(e) => {
                log::error!("Failed to get providers proxies: {}", e);
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn test_mihomo_manager_singleton() {
        let manager1 = MihomoManager::new();
        let manager2 = MihomoManager::new();

        assert!(
            Arc::ptr_eq(&manager1, &manager2),
            "Should return same instance"
        );

        let manager = manager1.read();
        assert!(manager.proxies.is_null());
        assert!(manager.providers_proxies.is_null());
    }

    #[tokio::test]
    async fn test_refresh_proxies() {
        let manager = MihomoManager::new();

        // Test initial state
        {
            let data = manager.read();
            assert!(data.proxies.is_null());
        }

        // Test refresh
        {
            let mut data = manager.write();
            data.refresh_proxies().await;
            // Note: Since this depends on external API call,
            // we can only verify that the refresh call completes
            // without panicking. For more thorough testing,
            // we would need to mock the API caller.
        }
    }

    #[tokio::test]
    async fn test_refresh_providers_proxies() {
        let manager = MihomoManager::new();

        // Test initial state
        {
            let data = manager.read();
            assert!(data.providers_proxies.is_null());
        }

        // Test refresh
        {
            let mut data = manager.write();
            data.refresh_providers_proxies().await;
            // Note: Since this depends on external API call,
            // we can only verify that the refresh call completes
            // without panicking. For more thorough testing,
            // we would need to mock the API caller.
        }
    }

    #[tokio::test]
    async fn test_fetch_proxies() {
        let manager = MihomoManager::new();

        // Test initial state
        {
            let data = manager.read();
            let proxies = data.fetch_proxies();
            assert!(proxies.is_null());
        }

        // Test after refresh
        {
            let mut data = manager.write();
            data.refresh_proxies().await;
            let _proxies = data.fetch_proxies();
            // Can only verify the method returns without panicking
            // Would need API mocking for more thorough testing
        }
    }

    #[tokio::test]
    async fn test_fetch_providers_proxies() {
        let manager = MihomoManager::new();

        // Test initial state
        {
            let data = manager.read();
            let providers_proxies = data.fetch_providers_proxies();
            assert!(providers_proxies.is_null());
        }

        // Test after refresh
        {
            let mut data = manager.write();
            data.refresh_providers_proxies().await;
            let _providers_proxies = data.fetch_providers_proxies();
            // Can only verify the method returns without panicking
            // Would need API mocking for more thorough testing
        }
    }
}

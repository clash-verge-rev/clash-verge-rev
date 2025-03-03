use super::common::ApiCallerTrait;
use crate::config::api::mihomo::MIHOMO_URL;
use crate::model::api::common::ApiCaller;
use crate::model::api::mihomo::MihomoAPICaller;

use async_trait::async_trait;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;

impl MihomoAPICaller {
    #[allow(dead_code)]
    pub fn new() -> Arc<RwLock<Self>> {
        static INSTANCE: OnceCell<Arc<RwLock<MihomoAPICaller>>> = OnceCell::new();
        INSTANCE
            .get_or_init(|| {
                let client = Client::new();
                Arc::new(RwLock::new(MihomoAPICaller {
                    caller: ApiCaller {
                        url: MIHOMO_URL,
                        client,
                    },
                }))
            })
            .clone()
    }
}

#[async_trait]
impl ApiCallerTrait for MihomoAPICaller {
    async fn call_api<T>(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        headers: Option<Vec<(&str, &str)>>,
    ) -> Result<T, String>
    where
        T: DeserializeOwned + Send + Sync,
    {
        let response = self
            .caller
            .send_request(method, path, body, headers)
            .await
            .map_err(|e| e.to_string())?;
        Self::parse_json_response::<T>(&response)
    }
}

#[allow(unused)]
impl MihomoAPICaller {
    pub async fn get_proxies() -> Result<serde_json::Value, String> {
        Self::new()
            .read()
            .call_api("GET", "/proxies", None, None)
            .await
    }

    pub async fn get_providers_proxies() -> Result<serde_json::Value, String> {
        Self::new()
            .read()
            .call_api("GET", "/providers/proxies", None, None)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mihomo_api_singleton() {
        let mihomo_api_caller1 = MihomoAPICaller::new();
        let mihomo_api_caller2 = MihomoAPICaller::new();
        assert!(Arc::ptr_eq(&mihomo_api_caller1, &mihomo_api_caller2));
    }

    #[tokio::test]
    async fn test_mihomo_api_version() {
        let mihomo_caller = MihomoAPICaller::new();
        let response: Result<serde_json::Value, String> = mihomo_caller
            .read()
            .call_api("GET", "/version", None, None)
            .await;
        assert!(response.is_ok());
    }

    #[tokio::test]
    async fn test_mihomo_get_proxies() {
        let response = MihomoAPICaller::get_proxies().await;
        assert!(response.is_ok());
        if let Ok(proxies) = &response {
            assert!(!proxies.get("proxies").is_none());
        }
    }

    #[tokio::test]
    async fn test_mihomo_get_providers_proxies() {
        let response = MihomoAPICaller::get_providers_proxies().await;
        println!("{:?}", response);
        assert!(response.is_ok());
        if let Ok(providers_proxies) = &response {
            assert!(!providers_proxies.get("providers").is_none());
        }
    }
}

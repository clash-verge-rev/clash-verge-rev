use reqwest::header::HeaderMap;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
pub mod model;
pub use model::{MihomoData, MihomoManager};

impl MihomoManager {
    pub fn new(mihomo_server: String, headers: HeaderMap) -> Self {
        Self {
            mihomo_server,
            data: Arc::new(Mutex::new(MihomoData {
                proxies: serde_json::Value::Null,
                providers_proxies: serde_json::Value::Null,
            })),
            headers: headers,
        }
    }

    fn update_proxies(&self, proxies: serde_json::Value) {
        let mut data = self.data.lock().unwrap();
        data.proxies = proxies;
    }

    fn update_providers_proxies(&self, providers_proxies: serde_json::Value) {
        let mut data = self.data.lock().unwrap();
        data.providers_proxies = providers_proxies;
    }

    pub fn get_mihomo_server(&self) -> String {
        self.mihomo_server.clone()
    }

    pub fn get_proxies(&self) -> serde_json::Value {
        let data = self.data.lock().unwrap();
        data.proxies.clone()
    }

    pub fn get_providers_proxies(&self) -> serde_json::Value {
        let data = self.data.lock().unwrap();
        data.providers_proxies.clone()
    }

    pub async fn refresh_proxies(&self) -> Result<&Self, String> {
        let url = format!("{}/proxies", self.mihomo_server);
        let response = reqwest::ClientBuilder::new()
            .default_headers(self.headers.clone())
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| e.to_string())?
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| e.to_string())?;
        let proxies = response;
        self.update_proxies(proxies);
        Ok(self)
    }

    pub async fn refresh_providers_proxies(&self) -> Result<&Self, String> {
        let url = format!("{}/providers/proxies", self.mihomo_server);
        let response = reqwest::ClientBuilder::new()
            .default_headers(self.headers.clone())
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| e.to_string())?
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| e.to_string())?;
        let proxies = response;
        self.update_providers_proxies(proxies);
        Ok(self)
    }
}

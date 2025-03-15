use reqwest::{Method, header::HeaderMap};
use serde_json::json;
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
            headers,
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

    async fn send_request(
        &self,
        method: Method,
        url: String,
        data: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let client_response = reqwest::ClientBuilder::new()
            .default_headers(self.headers.clone())
            .no_proxy()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?
            .request(method.clone(), &url)
            .json(&data.unwrap_or(json!({})))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let response = match method {
            Method::PATCH => {
                let status = client_response.status();
                if status.as_u16() == 204 {
                    json!({"code": 204})
                } else {
                    client_response
                        .json::<serde_json::Value>()
                        .await
                        .map_err(|e| e.to_string())?
                }
            }
            Method::PUT => json!(client_response.text().await.map_err(|e| e.to_string())?),
            _ => client_response
                .json::<serde_json::Value>()
                .await
                .map_err(|e| e.to_string())?,
        };
        Ok(response)
    }

    pub async fn refresh_proxies(&self) -> Result<&Self, String> {
        let url = format!("{}/proxies", self.mihomo_server);
        let proxies = self.send_request(Method::GET, url, None).await?;
        self.update_proxies(proxies);
        Ok(self)
    }

    pub async fn refresh_providers_proxies(&self) -> Result<&Self, String> {
        let url = format!("{}/providers/proxies", self.mihomo_server);
        let providers_proxies = self.send_request(Method::GET, url, None).await?;
        self.update_providers_proxies(providers_proxies);
        Ok(self)
    }
}

impl MihomoManager {
    pub async fn put_configs_force(&self, clash_config_path: &str) -> Result<(), String> {
        let url = format!("{}/configs?force=true", self.mihomo_server);
        let payload = serde_json::json!({
            "path": clash_config_path,
        });
        let _response = self.send_request(Method::PUT, url, Some(payload)).await?;
        Ok(())
    }

    pub async fn patch_configs(&self, config: serde_json::Value) -> Result<(), String> {
        let url = format!("{}/configs", self.mihomo_server);
        let response = self.send_request(Method::PATCH, url, Some(config)).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(response["message"]
                .as_str()
                .unwrap_or("unknown error")
                .to_string())
        }
    }

    pub async fn test_proxy_delay(
        &self,
        name: &str,
        test_url: Option<String>,
        timeout: i32,
    ) -> Result<serde_json::Value, String> {
        let test_url = test_url.unwrap_or("http://cp.cloudflare.com/generate_204".to_string());
        let url = format!(
            "{}/proxies/{}/delay?url={}&timeout={}",
            self.mihomo_server, name, test_url, timeout
        );
        let response = self.send_request(Method::GET, url, None).await?;
        Ok(response)
    }
}

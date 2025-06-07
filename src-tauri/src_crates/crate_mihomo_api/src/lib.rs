use reqwest::{Method, header::HeaderMap};
use serde_json::{Value, json};
use std::time::Duration;
pub mod model;
pub use model::MihomoManager;

impl MihomoManager {
    pub fn new(mihomo_server: String, headers: HeaderMap) -> Self {
        let client = reqwest::ClientBuilder::new()
            .default_headers(headers)
            .no_proxy()
            .timeout(Duration::from_secs(15))
            .pool_max_idle_per_host(5)
            .pool_idle_timeout(Duration::from_secs(15))
            .build()
            .expect("Failed to build reqwest client");

        Self {
            mihomo_server,
            client,
        }
    }

    async fn send_request(
        &self,
        method: Method,
        url: String,
        data: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let client_response = self
            .client
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

    pub async fn get_refresh_proxies(&self) -> Result<Value, String> {
        let url = format!("{}/proxies", self.mihomo_server);
        let proxies = self.send_request(Method::GET, url, None).await?;
        Ok(proxies)
    }

    pub async fn get_providers_proxies(&self) -> Result<Value, String> {
        let url = format!("{}/providers/proxies", self.mihomo_server);
        let providers_proxies = self.send_request(Method::GET, url, None).await?;
        Ok(providers_proxies)
    }

    pub async fn close_all_connections(&self) -> Result<(), String> {
        let url = format!("{}/connections", self.mihomo_server);
        let response = self.send_request(Method::DELETE, url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(response["message"]
                .as_str()
                .unwrap_or("unknown error")
                .to_string())
        }
    }
}

impl MihomoManager {
    pub async fn is_mihomo_running(&self) -> Result<(), String> {
        let url = format!("{}/version", self.mihomo_server);
        let _response = self.send_request(Method::GET, url, None).await?;
        Ok(())
    }

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
        let test_url = test_url.unwrap_or("https://cp.cloudflare.com/generate_204".to_string());
        let url = format!(
            "{}/proxies/{}/delay?url={}&timeout={}",
            self.mihomo_server, name, test_url, timeout
        );
        let response = self.send_request(Method::GET, url, None).await?;
        Ok(response)
    }

    pub async fn get_connections(&self) -> Result<serde_json::Value, String> {
        let url = format!("{}/connections", self.mihomo_server);
        let response = self.send_request(Method::GET, url, None).await?;
        Ok(response)
    }

    pub async fn delete_connection(&self, id: &str) -> Result<(), String> {
        let url = format!("{}/connections/{}", self.mihomo_server, id);
        let response = self.send_request(Method::DELETE, url, None).await?;
        if response["code"] == 204 {
            Ok(())
        } else {
            Err(response["message"]
                .as_str()
                .unwrap_or("unknown error")
                .to_string())
        }
    }
}

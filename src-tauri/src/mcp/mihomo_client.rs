use anyhow::{Context as _, Result};
use reqwest::Client;
use serde_json::Value;

use crate::config::Config;

#[derive(Default)]
pub struct MihomoClient {
    client: Client,
}

impl MihomoClient {
    async fn base_url_and_secret() -> Result<(String, Option<String>)> {
        let info = Config::clash().await.data_arc().get_client_info();
        let base = format!("http://{}", info.server);
        Ok((base, info.secret))
    }

    fn build_request(&self, method: reqwest::Method, url: &str, secret: &Option<String>) -> reqwest::RequestBuilder {
        let mut req = self.client.request(method, url);
        if let Some(s) = secret {
            req = req.header("Authorization", format!("Bearer {s}"));
        }
        req
    }

    async fn get(&self, path: &str) -> Result<Value> {
        let (base, secret) = Self::base_url_and_secret().await?;
        let url = format!("{base}{path}");
        let resp = self
            .build_request(reqwest::Method::GET, &url, &secret)
            .send()
            .await
            .context("mihomo API request failed")?;
        resp.json::<Value>().await.context("failed to parse mihomo response")
    }

    async fn put(&self, path: &str, body: &Value) -> Result<Value> {
        let (base, secret) = Self::base_url_and_secret().await?;
        let url = format!("{base}{path}");
        let resp = self
            .build_request(reqwest::Method::PUT, &url, &secret)
            .json(body)
            .send()
            .await
            .context("mihomo API PUT failed")?;
        if resp.content_length().unwrap_or(0) == 0 {
            return Ok(Value::Object(serde_json::Map::new()));
        }
        resp.json::<Value>().await.context("failed to parse mihomo response")
    }

    async fn patch(&self, path: &str, body: &Value) -> Result<Value> {
        let (base, secret) = Self::base_url_and_secret().await?;
        let url = format!("{base}{path}");
        let resp = self
            .build_request(reqwest::Method::PATCH, &url, &secret)
            .json(body)
            .send()
            .await
            .context("mihomo API PATCH failed")?;
        if resp.content_length().unwrap_or(0) == 0 {
            return Ok(Value::Object(serde_json::Map::new()));
        }
        resp.json::<Value>().await.context("failed to parse mihomo response")
    }

    async fn delete(&self, path: &str) -> Result<Value> {
        let (base, secret) = Self::base_url_and_secret().await?;
        let url = format!("{base}{path}");
        let resp = self
            .build_request(reqwest::Method::DELETE, &url, &secret)
            .send()
            .await
            .context("mihomo API DELETE failed")?;
        if resp.content_length().unwrap_or(0) == 0 {
            return Ok(Value::Object(serde_json::Map::new()));
        }
        resp.json::<Value>().await.context("failed to parse mihomo response")
    }

    // ──── Proxy APIs ────

    pub async fn get_proxies(&self) -> Result<Value> {
        self.get("/proxies").await
    }

    pub async fn select_proxy(&self, group: &str, name: &str) -> Result<Value> {
        let encoded_group =
            percent_encoding::utf8_percent_encode(group, percent_encoding::NON_ALPHANUMERIC).to_string();
        let body = serde_json::json!({ "name": name });
        self.put(&format!("/proxies/{encoded_group}"), &body).await
    }

    pub async fn get_proxy_delay(&self, name: &str, url: &str, timeout: u32) -> Result<Value> {
        let encoded_name = percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC).to_string();
        let (base, secret) = Self::base_url_and_secret().await?;
        let full_url = format!(
            "{base}/proxies/{encoded_name}/delay?url={}&timeout={timeout}",
            percent_encoding::utf8_percent_encode(url, percent_encoding::NON_ALPHANUMERIC)
        );
        let resp = self
            .build_request(reqwest::Method::GET, &full_url, &secret)
            .send()
            .await
            .context("proxy delay test failed")?;
        resp.json::<Value>().await.context("failed to parse delay response")
    }

    pub async fn get_proxy_providers(&self) -> Result<Value> {
        self.get("/providers/proxies").await
    }

    pub async fn update_proxy_provider(&self, name: &str) -> Result<Value> {
        let encoded = percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC).to_string();
        self.put(
            &format!("/providers/proxies/{encoded}"),
            &Value::Object(serde_json::Map::new()),
        )
        .await
    }

    // ──── Connection APIs ────

    pub async fn get_connections(&self) -> Result<Value> {
        self.get("/connections").await
    }

    pub async fn close_all_connections(&self) -> Result<Value> {
        self.delete("/connections").await
    }

    pub async fn close_connection(&self, id: &str) -> Result<Value> {
        self.delete(&format!("/connections/{id}")).await
    }

    // ──── Rule APIs ────

    pub async fn get_rules(&self) -> Result<Value> {
        self.get("/rules").await
    }

    // ──── Config APIs ────

    pub async fn get_config(&self) -> Result<Value> {
        self.get("/configs").await
    }

    pub async fn patch_config(&self, payload: &Value) -> Result<Value> {
        self.patch("/configs", payload).await
    }

    // ──── Version ────

    pub async fn get_version(&self) -> Result<Value> {
        self.get("/version").await
    }
}

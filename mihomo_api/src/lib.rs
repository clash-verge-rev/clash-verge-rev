pub mod api;
pub mod model;
#[cfg(feature = "websocket")]
pub mod websocket_client;

use anyhow::{bail, Result};
use model::{MihomoVersion, Protocol};
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method, RequestBuilder,
};
use serde::{Deserialize, Serialize};

#[cfg(feature = "websocket")]
use std::collections::HashMap;
#[cfg(feature = "websocket")]
use websocket_client::MihomoWebsocketClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mihomo {
    protocol: Protocol,
    external_host: String,
    external_port: u32,
    secret: Option<String>,
}

#[allow(dead_code)]
impl Mihomo {
    pub fn set_protocol(&mut self, protocol: Protocol) {
        self.protocol = protocol;
    }

    pub fn set_external_host<S: Into<String>>(&mut self, host: S) {
        self.external_host = host.into();
    }

    pub fn set_external_port(&mut self, port: u32) {
        self.external_port = port;
    }

    pub fn set_secret<S: Into<String>>(&mut self, secret: S) {
        self.secret = Some(secret.into());
    }

    fn get_req_url(&self, suffix_url: &str) -> Result<String> {
        if self.external_host.is_empty() {
            bail!("not found external host, please set external host");
        }
        let server = format!(
            "{}://{}:{}{}",
            self.protocol, self.external_host, self.external_port, suffix_url
        );
        Ok(server)
    }

    fn get_req_headers(&self) -> Result<HeaderMap<HeaderValue>> {
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse()?);
        if let Some(secret) = self.secret.clone() {
            let auth_value = format!("Bearer {}", secret).parse()?;
            headers.insert("Authorization", auth_value);
        }
        Ok(headers)
    }

    #[cfg(feature = "websocket")]
    fn get_websocket_url(&self, suffix_url: &str) -> Result<String> {
        if self.external_host.is_empty() {
            bail!("not found external host, please set external host");
        }
        let ws_url = match &self.secret {
            Some(secret) => {
                format!(
                    "ws://{}:{}/{}?token={}",
                    self.external_host, self.external_port, suffix_url, secret
                )
            }
            None => {
                format!(
                    "ws://{}:{}/{}",
                    self.external_host, self.external_port, suffix_url
                )
            }
        };
        Ok(ws_url)
    }

    fn build_requet(&self, method: Method, suffix_url: &str) -> Result<RequestBuilder> {
        let url = self.get_req_url(suffix_url)?;
        let headers = self.get_req_headers()?;
        let client = reqwest::ClientBuilder::new().build()?;
        match method {
            Method::POST => Ok(client.post(url).headers(headers)),
            Method::GET => Ok(client.get(url).headers(headers)),
            Method::PUT => Ok(client.put(url).headers(headers)),
            Method::PATCH => Ok(client.patch(url).headers(headers)),
            Method::DELETE => Ok(client.delete(url).headers(headers)),
            _ => {
                bail!("mihomo client has not support {} method", method.as_str())
            }
        }
    }

    #[cfg(feature = "websocket")]
    async fn connect_websocket(
        &self,
        suffix_url: &str,
        params: Option<HashMap<String, String>>,
    ) -> Result<MihomoWebsocketClient> {
        let mut ws_url = self.get_websocket_url(suffix_url)?;
        params.map(|v| {
            v.iter()
                .for_each(|i| ws_url = format!("{}&{}={}", ws_url, i.0, i.1));
        });
        println!("ws url: {}", ws_url);
        // 测试 websocket 的 TLS 连接
        // let ws_url = "wss://toolin.cn/echo";
        Ok(MihomoWebsocketClient::connect(&ws_url).await?)
    }

    #[cfg(feature = "websocket")]
    pub async fn ws_logs(&self, level: &str) -> Result<MihomoWebsocketClient> {
        let params = HashMap::from([("level".to_string(), level.to_string())]);
        let ws_client = self.connect_websocket("logs", Some(params)).await?;
        Ok(ws_client)
    }

    #[cfg(feature = "websocket")]
    pub async fn ws_connections(&self) -> Result<MihomoWebsocketClient> {
        let ws_client = self.connect_websocket("connections", None).await?;
        Ok(ws_client)
    }

    #[cfg(feature = "websocket")]
    pub async fn ws_memory(&self) -> Result<MihomoWebsocketClient> {
        let ws_client = self.connect_websocket("memory", None).await?;
        Ok(ws_client)
    }

    #[cfg(feature = "websocket")]
    pub async fn ws_traffic(&self) -> Result<MihomoWebsocketClient> {
        let ws_client = self.connect_websocket("traffic", None).await?;
        Ok(ws_client)
    }

    pub async fn get_version(&self) -> Result<MihomoVersion> {
        let client = self.build_requet(Method::GET, "/version")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get mihomo version erro");
        }
        Ok(response.json::<MihomoVersion>().await?)
    }

    pub async fn clean_fakeip(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/cache/fakeip/flush")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("clean fakeip cache error");
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct MihomoBuilder {
    protocol: Protocol,
    external_host: String,
    external_port: u32,
    secret: Option<String>,
}

impl Default for MihomoBuilder {
    fn default() -> Self {
        Self {
            protocol: Protocol::Http,
            external_host: "127.0.0.1".to_string(),
            external_port: 9090,
            secret: None,
        }
    }
}

impl MihomoBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_protocol(mut self, protocol: Protocol) -> Self {
        self.protocol = protocol;
        self
    }

    pub fn set_external_host<S: Into<String>>(mut self, host: S) -> Self {
        self.external_host = host.into();
        self
    }

    pub fn set_external_port(mut self, port: u32) -> Self {
        self.external_port = port;
        self
    }

    pub fn set_secret<S: Into<String>>(mut self, secret: S) -> Self {
        self.secret = Some(secret.into());
        self
    }

    pub fn build(self) -> Result<Mihomo> {
        Ok(Mihomo {
            protocol: self.protocol,
            external_host: self.external_host,
            external_port: self.external_port,
            secret: self.secret,
        })
    }
}

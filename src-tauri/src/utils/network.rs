use crate::config::Config;
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use reqwest::{
    Client, Proxy, StatusCode,
    header::{HeaderMap, HeaderValue, USER_AGENT},
};
use smartstring::alias::String;
use std::time::{Duration, Instant};
use sysproxy::Sysproxy;
use tauri::Url;
use tokio::sync::Mutex;

#[derive(Debug)]
pub struct HttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl HttpResponse {
    pub const fn new(status: StatusCode, headers: HeaderMap, body: String) -> Self {
        Self { status, headers, body }
    }

    pub const fn status(&self) -> StatusCode {
        self.status
    }

    pub const fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub fn text_with_charset(&self) -> Result<&str> {
        Ok(&self.body)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ProxyType {
    None,
    Localhost,
    System,
}

pub struct NetworkManager {
    self_proxy_client: Mutex<Option<Client>>,
    system_proxy_client: Mutex<Option<Client>>,
    no_proxy_client: Mutex<Option<Client>>,
    last_connection_error: Mutex<Option<(Instant, String)>>,
    connection_error_count: Mutex<usize>,
}

impl Default for NetworkManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkManager {
    pub fn new() -> Self {
        Self {
            self_proxy_client: Mutex::new(None),
            system_proxy_client: Mutex::new(None),
            no_proxy_client: Mutex::new(None),
            last_connection_error: Mutex::new(None),
            connection_error_count: Mutex::new(0),
        }
    }

    async fn record_connection_error(&self, error: &str) {
        *self.last_connection_error.lock().await = Some((Instant::now(), error.into()));

        let mut count = self.connection_error_count.lock().await;
        *count += 1;
    }

    async fn should_reset_clients(&self) -> bool {
        let count = *self.connection_error_count.lock().await;
        if count > 5 {
            return true;
        }

        if let Some((time, _)) = &*self.last_connection_error.lock().await
            && time.elapsed() < Duration::from_secs(30)
            && count > 2
        {
            return true;
        }

        false
    }

    pub async fn reset_clients(&self) {
        *self.self_proxy_client.lock().await = None;
        *self.system_proxy_client.lock().await = None;
        *self.no_proxy_client.lock().await = None;
        *self.connection_error_count.lock().await = 0;
    }

    fn build_client(
        &self,
        proxy_url: Option<std::string::String>,
        default_headers: HeaderMap,
        accept_invalid_certs: bool,
        timeout_secs: Option<u64>,
    ) -> Result<Client> {
        let mut builder = Client::builder()
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::limited(10))
            .tcp_keepalive(Duration::from_secs(60))
            .pool_max_idle_per_host(0)
            .pool_idle_timeout(None);

        // 设置代理
        if let Some(proxy_str) = proxy_url {
            let proxy = Proxy::all(proxy_str)?;
            builder = builder.proxy(proxy);
        } else {
            builder = builder.no_proxy();
        }

        builder = builder.default_headers(default_headers);

        // SSL/TLS
        if accept_invalid_certs {
            builder = builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }

        // 超时设置
        if let Some(secs) = timeout_secs {
            builder = builder
                .timeout(Duration::from_secs(secs))
                .connect_timeout(Duration::from_secs(secs.min(30)));
        }

        Ok(builder.build()?)
    }

    pub async fn create_request(
        &self,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<Client> {
        let proxy_url: Option<std::string::String> = match proxy_type {
            ProxyType::None => None,
            ProxyType::Localhost => {
                let port = {
                    let verge_port = Config::verge().await.data_arc().verge_mixed_port;
                    match verge_port {
                        Some(port) => port,
                        None => Config::clash().await.data_arc().get_mixed_port(),
                    }
                };
                Some(format!("http://127.0.0.1:{port}"))
            }
            ProxyType::System => {
                if let Ok(p @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() {
                    Some(format!("http://{}:{}", p.host, p.port))
                } else {
                    None
                }
            }
        };

        let mut headers = HeaderMap::new();

        // 设置 User-Agent
        if let Some(ua) = user_agent {
            headers.insert(USER_AGENT, HeaderValue::from_str(ua.as_str())?);
        } else {
            headers.insert(
                USER_AGENT,
                HeaderValue::from_str(&format!("clash-verge/v{}", env!("CARGO_PKG_VERSION")))?,
            );
        }

        let client = self.build_client(proxy_url, headers, accept_invalid_certs, timeout_secs)?;

        Ok(client)
    }

    pub async fn get_with_interrupt(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<HttpResponse> {
        if self.should_reset_clients().await {
            self.reset_clients().await;
        }

        let parsed = Url::parse(url)?;
        let mut extra_headers = HeaderMap::new();

        if !parsed.username().is_empty()
            && let Some(pass) = parsed.password()
        {
            let auth_str = format!("{}:{}", parsed.username(), pass);
            let encoded = general_purpose::STANDARD.encode(auth_str);
            extra_headers.insert("Authorization", HeaderValue::from_str(&format!("Basic {}", encoded))?);
        }

        let clean_url = {
            let mut no_auth = parsed.clone();
            no_auth.set_username("").ok();
            no_auth.set_password(None).ok();
            no_auth.to_string()
        };

        // 创建请求
        let client = self
            .create_request(proxy_type, timeout_secs, user_agent, accept_invalid_certs)
            .await?;

        let mut request_builder = client.get(&clean_url);

        for (key, value) in extra_headers.iter() {
            request_builder = request_builder.header(key, value);
        }

        let response = match request_builder.send().await {
            Ok(resp) => resp,
            Err(e) => {
                self.record_connection_error(&format!("Request failed: {}", e)).await;
                return Err(anyhow::anyhow!("Request failed: {}", e));
            }
        };

        let status = response.status();
        let headers = response.headers().clone();
        let body = match response.text().await {
            Ok(text) => text.into(),
            Err(e) => {
                self.record_connection_error(&format!("Failed to read response body: {}", e))
                    .await;
                return Err(anyhow::anyhow!("Failed to read response body: {}", e));
            }
        };

        Ok(HttpResponse::new(status, headers, body))
    }
}

use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use isahc::prelude::*;
use isahc::{
    config::RedirectPolicy,
    http::{
        header::{HeaderMap, HeaderValue, USER_AGENT},
        StatusCode, Uri,
    },
};
use isahc::{config::SslOption, HttpClient};
use std::time::{Duration, Instant};
use sysproxy::Sysproxy;
use tauri::Url;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::config::Config;

#[derive(Debug)]
pub struct HttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl HttpResponse {
    pub fn new(status: StatusCode, headers: HeaderMap, body: String) -> Self {
        Self {
            status,
            headers,
            body,
        }
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn headers(&self) -> &HeaderMap {
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
    self_proxy_client: Mutex<Option<HttpClient>>,
    system_proxy_client: Mutex<Option<HttpClient>>,
    no_proxy_client: Mutex<Option<HttpClient>>,
    last_connection_error: Mutex<Option<(Instant, String)>>,
    connection_error_count: Mutex<usize>,
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
        let mut last_error = self.last_connection_error.lock().await;
        *last_error = Some((Instant::now(), error.to_string()));

        let mut count = self.connection_error_count.lock().await;
        *count += 1;
    }

    async fn should_reset_clients(&self) -> bool {
        let count = *self.connection_error_count.lock().await;
        let last_error_guard = self.last_connection_error.lock().await;

        if count > 5 {
            return true;
        }

        if let Some((time, _)) = &*last_error_guard {
            if time.elapsed() < Duration::from_secs(30) && count > 2 {
                return true;
            }
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
        proxy_uri: Option<Uri>,
        default_headers: HeaderMap,
        accept_invalid_certs: bool,
        timeout_secs: Option<u64>,
    ) -> Result<HttpClient> {
        let proxy_uri_clone = proxy_uri.clone();
        let headers_clone = default_headers.clone();
        let client = {
            let mut builder = HttpClient::builder();

            builder = match proxy_uri_clone {
                Some(uri) => builder.proxy(Some(uri)),
                None => builder.proxy(None),
            };

            for (name, value) in headers_clone.iter() {
                builder = builder.default_header(name, value);
            }

            if accept_invalid_certs {
                builder = builder.ssl_options(SslOption::DANGER_ACCEPT_INVALID_CERTS);
            }

            if let Some(secs) = timeout_secs {
                builder = builder.timeout(Duration::from_secs(secs));
            }

            builder = builder.redirect_policy(RedirectPolicy::Follow);

            Ok(builder.build()?)
        };

        client
    }

    pub async fn create_request(
        &self,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<HttpClient> {
        let proxy_uri = match proxy_type {
            ProxyType::None => None,
            ProxyType::Localhost => {
                let port = {
                    let verge_port = Config::verge().await.latest_ref().verge_mixed_port;
                    match verge_port {
                        Some(port) => port,
                        None => Config::clash().await.latest_ref().get_mixed_port(),
                    }
                };
                let proxy_scheme = format!("http://127.0.0.1:{port}");
                proxy_scheme.parse::<Uri>().ok()
            }
            ProxyType::System => {
                if let Ok(p @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() {
                    let proxy_scheme = format!("http://{}:{}", p.host, p.port);
                    proxy_scheme.parse::<Uri>().ok()
                } else {
                    None
                }
            }
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_str(
                &user_agent
                    .unwrap_or_else(|| format!("clash-verge/v{}", env!("CARGO_PKG_VERSION"))),
            )?,
        );

        let client = self.build_client(proxy_uri, headers, accept_invalid_certs, timeout_secs)?;

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

        if !parsed.username().is_empty() {
            if let Some(pass) = parsed.password() {
                let auth_str = format!("{}:{}", parsed.username(), pass);
                let encoded = general_purpose::STANDARD.encode(auth_str);
                extra_headers.insert(
                    "Authorization",
                    HeaderValue::from_str(&format!("Basic {}", encoded))?,
                );
            }
        }

        let clean_url = {
            let mut no_auth = parsed.clone();
            no_auth.set_username("").ok();
            no_auth.set_password(None).ok();
            no_auth.to_string()
        };

        let client = self
            .create_request(proxy_type, timeout_secs, user_agent, accept_invalid_certs)
            .await?;

        let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(20));
        let response = match timeout(timeout_duration, async {
            let mut req = isahc::Request::get(&clean_url);

            for (k, v) in extra_headers.iter() {
                req = req.header(k, v);
            }

            let mut response = client.send_async(req.body(())?).await?;
            let status = response.status();
            let headers = response.headers().clone();
            let body = response.text().await?;
            Ok::<_, anyhow::Error>(HttpResponse::new(status, headers, body))
        })
        .await
        {
            Ok(res) => res?,
            Err(_) => {
                self.record_connection_error(&format!("Request interrupted: {}", url))
                    .await;
                return Err(anyhow::anyhow!(
                    "Request interrupted after {}s",
                    timeout_duration.as_secs()
                ));
            }
        };

        Ok(response)
    }
}

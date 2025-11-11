use crate::config::Config;
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use isahc::config::DnsCache;
use isahc::prelude::*;
use isahc::{HttpClient, config::SslOption};
use isahc::{
    config::RedirectPolicy,
    http::{
        StatusCode, Uri,
        header::{HeaderMap, HeaderValue, USER_AGENT},
    },
};
use smartstring::alias::String;
use std::time::{Duration, Instant};
use sysproxy::Sysproxy;
use tauri::Url;
use tokio::sync::Mutex;
use tokio::time::timeout;

#[derive(Debug)]
pub struct HttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl HttpResponse {
    pub const fn new(status: StatusCode, headers: HeaderMap, body: String) -> Self {
        Self {
            status,
            headers,
            body,
        }
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
    self_proxy_client: Mutex<Option<HttpClient>>,
    system_proxy_client: Mutex<Option<HttpClient>>,
    no_proxy_client: Mutex<Option<HttpClient>>,
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
        proxy_uri: Option<Uri>,
        default_headers: HeaderMap,
        accept_invalid_certs: bool,
        timeout_secs: Option<u64>,
    ) -> Result<HttpClient> {
        {
            let mut builder = HttpClient::builder();

            builder = match proxy_uri {
                Some(uri) => builder.proxy(Some(uri)),
                None => builder.proxy(None),
            };

            for (name, value) in default_headers.iter() {
                builder = builder.default_header(name, value);
            }

            if accept_invalid_certs {
                builder = builder.ssl_options(SslOption::DANGER_ACCEPT_INVALID_CERTS);
            }

            if let Some(secs) = timeout_secs {
                builder = builder.timeout(Duration::from_secs(secs));
            }

            builder = builder.redirect_policy(RedirectPolicy::Follow);

            // 禁用缓存，不关心连接复用
            builder = builder.connection_cache_size(0);

            // 禁用 DNS 缓存，避免因 DNS 变化导致的问题
            builder = builder.dns_cache(DnsCache::Disable);

            Ok(builder.build()?)
        }
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
                    let verge_port = Config::verge().await.data_arc().verge_mixed_port;
                    match verge_port {
                        Some(port) => port,
                        None => Config::clash().await.data_arc().get_mixed_port(),
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
                &user_agent.unwrap_or_else(|| {
                    format!("clash-verge/v{}", env!("CARGO_PKG_VERSION")).into()
                }),
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

        if !parsed.username().is_empty()
            && let Some(pass) = parsed.password()
        {
            let auth_str = format!("{}:{}", parsed.username(), pass);
            let encoded = general_purpose::STANDARD.encode(auth_str);
            extra_headers.insert(
                "Authorization",
                HeaderValue::from_str(&format!("Basic {}", encoded))?,
            );
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
            Ok::<_, anyhow::Error>(HttpResponse::new(status, headers, body.into()))
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

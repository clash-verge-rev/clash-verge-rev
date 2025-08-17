use anyhow::Result;
use parking_lot::Mutex;
use reqwest::{Client, ClientBuilder, Proxy, RequestBuilder, Response};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Once,
    },
    time::{Duration, Instant},
};
use tokio::runtime::{Builder, Runtime};

use crate::{config::Config, logging, singleton_lazy, utils::logging::Type};

// HTTP2 相关
const H2_CONNECTION_WINDOW_SIZE: u32 = 1024 * 1024;
const H2_STREAM_WINDOW_SIZE: u32 = 1024 * 1024;
const H2_MAX_FRAME_SIZE: u32 = 16 * 1024;
const H2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(5);
const H2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const POOL_MAX_IDLE_PER_HOST: usize = 5;
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(15);

/// 网络管理器
pub struct NetworkManager {
    runtime: Arc<Runtime>,
    self_proxy_client: Mutex<Option<Client>>,
    system_proxy_client: Mutex<Option<Client>>,
    no_proxy_client: Mutex<Option<Client>>,
    init: Once,
    last_connection_error: Mutex<Option<(Instant, String)>>,
    connection_error_count: AtomicUsize,
}

// Use singleton_lazy macro to replace lazy_static!
singleton_lazy!(NetworkManager, NETWORK_MANAGER, NetworkManager::new);

impl NetworkManager {
    fn new() -> Self {
        // 创建专用的异步运行时，线程数限制为4个
        let runtime = match Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("clash-verge-network")
            .enable_io()
            .enable_time()
            .build()
        {
            Ok(runtime) => runtime,
            Err(e) => {
                log::error!(
                    "Failed to create network runtime: {}. Using fallback single-threaded runtime.",
                    e
                );
                // Fallback to current thread runtime
                match Builder::new_current_thread()
                    .enable_io()
                    .enable_time()
                    .thread_name("clash-verge-network-fallback")
                    .build()
                {
                    Ok(fallback_runtime) => fallback_runtime,
                    Err(fallback_err) => {
                        log::error!(
                            "Failed to create fallback runtime: {}. This is critical.",
                            fallback_err
                        );
                        std::process::exit(1);
                    }
                }
            }
        };

        NetworkManager {
            runtime: Arc::new(runtime),
            self_proxy_client: Mutex::new(None),
            system_proxy_client: Mutex::new(None),
            no_proxy_client: Mutex::new(None),
            init: Once::new(),
            last_connection_error: Mutex::new(None),
            connection_error_count: AtomicUsize::new(0),
        }
    }

    /// 初始化网络客户端
    pub fn init(&self) {
        self.init.call_once(|| {
            self.runtime.spawn(async {
                logging!(info, Type::Network, true, "初始化网络管理器");

                // 创建无代理客户端
                let no_proxy_client = match ClientBuilder::new()
                    .use_rustls_tls()
                    .no_proxy()
                    .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
                    .pool_idle_timeout(POOL_IDLE_TIMEOUT)
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(30))
                    .build()
                {
                    Ok(client) => client,
                    Err(e) => {
                        logging!(
                            error,
                            Type::Network,
                            true,
                            "Failed to build no_proxy client: {}",
                            e
                        );
                        return;
                    }
                };

                let mut no_proxy_guard = NetworkManager::global().no_proxy_client.lock();
                *no_proxy_guard = Some(no_proxy_client);

                logging!(info, Type::Network, true, "网络管理器初始化完成");
            });
        });
    }

    fn record_connection_error(&self, error: &str) {
        let mut last_error = self.last_connection_error.lock();
        *last_error = Some((Instant::now(), error.to_string()));

        self.connection_error_count.fetch_add(1, Ordering::Relaxed);
    }

    fn should_reset_clients(&self) -> bool {
        let error_count = self.connection_error_count.load(Ordering::Relaxed);
        let last_error = self.last_connection_error.lock();

        if error_count > 5 {
            return true;
        }

        if let Some((time, _)) = *last_error {
            if time.elapsed() < Duration::from_secs(30) && error_count > 2 {
                return true;
            }
        }

        false
    }

    pub fn reset_clients(&self) {
        logging!(info, Type::Network, true, "正在重置所有HTTP客户端");
        {
            let mut client = self.self_proxy_client.lock();
            *client = None;
        }
        {
            let mut client = self.system_proxy_client.lock();
            *client = None;
        }
        {
            let mut client = self.no_proxy_client.lock();
            *client = None;
        }
        self.connection_error_count.store(0, Ordering::Relaxed);
    }

    /// 创建带有自定义选项的HTTP请求
    pub fn create_request(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> RequestBuilder {
        if self.should_reset_clients() {
            self.reset_clients();
        }

        let mut builder = ClientBuilder::new()
            .use_rustls_tls()
            .pool_max_idle_per_host(POOL_MAX_IDLE_PER_HOST)
            .pool_idle_timeout(POOL_IDLE_TIMEOUT)
            .connect_timeout(DEFAULT_CONNECT_TIMEOUT)
            .http2_initial_stream_window_size(H2_STREAM_WINDOW_SIZE)
            .http2_initial_connection_window_size(H2_CONNECTION_WINDOW_SIZE)
            .http2_adaptive_window(true)
            .http2_keep_alive_interval(Some(H2_KEEP_ALIVE_INTERVAL))
            .http2_keep_alive_timeout(H2_KEEP_ALIVE_TIMEOUT)
            .http2_max_frame_size(H2_MAX_FRAME_SIZE)
            .tcp_keepalive(Some(Duration::from_secs(10)))
            .http2_max_header_list_size(16 * 1024);

        if let Some(timeout) = timeout_secs {
            builder = builder.timeout(Duration::from_secs(timeout));
        } else {
            builder = builder.timeout(DEFAULT_REQUEST_TIMEOUT);
        }

        match proxy_type {
            ProxyType::None => {
                builder = builder.no_proxy();
            }
            ProxyType::Localhost => {
                let port = Config::verge()
                    .latest_ref()
                    .verge_mixed_port
                    .unwrap_or(Config::clash().latest_ref().get_mixed_port());

                let proxy_scheme = format!("http://127.0.0.1:{port}");

                if let Ok(proxy) = Proxy::http(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
                if let Ok(proxy) = Proxy::https(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
                if let Ok(proxy) = Proxy::all(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
            }
            ProxyType::System => {
                use sysproxy::Sysproxy;

                if let Ok(p @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() {
                    let proxy_scheme = format!("http://{}:{}", p.host, p.port);

                    if let Ok(proxy) = Proxy::http(&proxy_scheme) {
                        builder = builder.proxy(proxy);
                    }
                    if let Ok(proxy) = Proxy::https(&proxy_scheme) {
                        builder = builder.proxy(proxy);
                    }
                    if let Ok(proxy) = Proxy::all(&proxy_scheme) {
                        builder = builder.proxy(proxy);
                    }
                }
            }
        }

        builder = builder.danger_accept_invalid_certs(accept_invalid_certs);

        if let Some(ua) = user_agent {
            builder = builder.user_agent(ua);
        } else {
            use crate::utils::resolve::VERSION;

            let version = match VERSION.get() {
                Some(v) => format!("clash-verge/v{v}"),
                None => "clash-verge/unknown".to_string(),
            };

            builder = builder.user_agent(version);
        }

        let client = match builder.build() {
            Ok(client) => client,
            Err(e) => {
                logging!(
                    error,
                    Type::Network,
                    true,
                    "Failed to build custom HTTP client: {}",
                    e
                );
                // Return a simple no-proxy client as fallback
                match ClientBuilder::new()
                    .use_rustls_tls()
                    .no_proxy()
                    .timeout(DEFAULT_REQUEST_TIMEOUT)
                    .build()
                {
                    Ok(fallback_client) => fallback_client,
                    Err(fallback_err) => {
                        logging!(
                            error,
                            Type::Network,
                            true,
                            "Failed to create fallback client: {}",
                            fallback_err
                        );
                        self.record_connection_error(&format!(
                            "Critical client build failure: {}",
                            fallback_err
                        ));
                        // Return a minimal client that will likely fail but won't panic
                        ClientBuilder::new().build().unwrap_or_else(|_| {
                            // If even the most basic client fails, this is truly critical
                            std::process::exit(1);
                        })
                    }
                }
            }
        };

        client.get(url)
    }

    /*     /// 执行GET请求，添加错误跟踪
    pub async fn get(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<Response> {
        let request = self.create_request(
            url,
            proxy_type,
            timeout_secs,
            user_agent,
            accept_invalid_certs,
        );

        let timeout_duration = timeout_secs.unwrap_or(30);

        match tokio::time::timeout(Duration::from_secs(timeout_duration), request.send()).await {
            Ok(result) => match result {
                Ok(response) => Ok(response),
                Err(e) => {
                    self.record_connection_error(&e.to_string());
                    Err(anyhow::anyhow!("Failed to send HTTP request: {}", e))
                }
            },
            Err(_) => {
                self.record_connection_error("Request timeout");
                Err(anyhow::anyhow!(
                    "HTTP request timed out after {} seconds",
                    timeout_duration
                ))
            }
        }
    } */

    pub async fn get_with_interrupt(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<Response> {
        let request = self.create_request(
            url,
            proxy_type,
            timeout_secs,
            user_agent,
            accept_invalid_certs,
        );

        let timeout_duration = timeout_secs.unwrap_or(20);

        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

        let url_clone = url.to_string();
        let watchdog = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(timeout_duration)).await;
            let _ = cancel_tx.send(());
            logging!(warn, Type::Network, true, "请求超时取消: {}", url_clone);
        });

        let result = tokio::select! {
            result = request.send() => result,
            _ = cancel_rx => {
                self.record_connection_error(&format!("Request interrupted for: {url}"));
                return Err(anyhow::anyhow!("Request interrupted after {} seconds", timeout_duration));
            }
        };
        watchdog.abort();

        match result {
            Ok(response) => Ok(response),
            Err(e) => {
                self.record_connection_error(&e.to_string());
                Err(anyhow::anyhow!("Failed to send HTTP request: {}", e))
            }
        }
    }
}

/// 代理类型
#[derive(Debug, Clone, Copy)]
pub enum ProxyType {
    None,
    Localhost,
    System,
}

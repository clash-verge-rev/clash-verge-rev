use anyhow::{Context, Result};
use lazy_static::lazy_static;
use reqwest::{Client, ClientBuilder, Proxy, RequestBuilder, Response};
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;
use tokio::runtime::{Builder, Runtime};

use crate::{config::Config, logging, utils::logging::Type};

/// 网络管理器
pub struct NetworkManager {
    runtime: Arc<Runtime>,
    self_proxy_client: Arc<Mutex<Option<Client>>>,
    system_proxy_client: Arc<Mutex<Option<Client>>>,
    no_proxy_client: Arc<Mutex<Option<Client>>>,
    init: Once,
}

lazy_static! {
    static ref NETWORK_MANAGER: NetworkManager = NetworkManager::new();
}

impl NetworkManager {
    fn new() -> Self {
        // 创建专用的异步运行时，线程数限制为4个
        let runtime = Builder::new_multi_thread()
            .worker_threads(4)
            .thread_name("clash-verge-network")
            .enable_io()
            .enable_time()
            .build()
            .expect("Failed to create network runtime");

        NetworkManager {
            runtime: Arc::new(runtime),
            self_proxy_client: Arc::new(Mutex::new(None)),
            system_proxy_client: Arc::new(Mutex::new(None)),
            no_proxy_client: Arc::new(Mutex::new(None)),
            init: Once::new(),
        }
    }

    pub fn global() -> &'static Self {
        &NETWORK_MANAGER
    }

    /// 初始化网络客户端
    pub fn init(&self) {
        self.init.call_once(|| {
            self.runtime.spawn(async {
                logging!(info, Type::Network, true, "初始化网络管理器");

                // 创建无代理客户端
                let no_proxy_client = ClientBuilder::new()
                    .use_rustls_tls()
                    .no_proxy()
                    .pool_max_idle_per_host(5)
                    .pool_idle_timeout(Duration::from_secs(30))
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(30))
                    .build()
                    .expect("Failed to build no_proxy client");

                let mut no_proxy_guard = NETWORK_MANAGER.no_proxy_client.lock().unwrap();
                *no_proxy_guard = Some(no_proxy_client);

                logging!(info, Type::Network, true, "网络管理器初始化完成");
            });
        });
    }

    /// 获取或创建自代理客户端
    fn get_or_create_self_proxy_client(&self) -> Client {
        let mut client_guard = self.self_proxy_client.lock().unwrap();

        if client_guard.is_none() {
            let port = Config::verge()
                .latest()
                .verge_mixed_port
                .unwrap_or(Config::clash().data().get_mixed_port());

            let proxy_scheme = format!("http://127.0.0.1:{port}");

            let mut builder = ClientBuilder::new()
                .use_rustls_tls()
                .pool_max_idle_per_host(5)
                .pool_idle_timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60));

            // 添加所有代理类型
            if let Ok(proxy) = Proxy::http(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }
            if let Ok(proxy) = Proxy::https(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }
            if let Ok(proxy) = Proxy::all(&proxy_scheme) {
                builder = builder.proxy(proxy);
            }

            let client = builder.build().expect("Failed to build self_proxy client");
            *client_guard = Some(client);
        }

        client_guard.as_ref().unwrap().clone()
    }

    /// 获取或创建系统代理客户端
    fn get_or_create_system_proxy_client(&self) -> Client {
        let mut client_guard = self.system_proxy_client.lock().unwrap();

        if client_guard.is_none() {
            use sysproxy::Sysproxy;

            let mut builder = ClientBuilder::new()
                .use_rustls_tls()
                .pool_max_idle_per_host(5)
                .pool_idle_timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60));

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

            let client = builder
                .build()
                .expect("Failed to build system_proxy client");
            *client_guard = Some(client);
        }

        client_guard.as_ref().unwrap().clone()
    }

    /// 根据代理设置选择合适的客户端
    pub fn get_client(&self, proxy_type: ProxyType) -> Client {
        match proxy_type {
            ProxyType::NoProxy => {
                let client_guard = self.no_proxy_client.lock().unwrap();
                client_guard.as_ref().unwrap().clone()
            }
            ProxyType::SelfProxy => self.get_or_create_self_proxy_client(),
            ProxyType::SystemProxy => self.get_or_create_system_proxy_client(),
        }
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
        let mut builder = ClientBuilder::new()
            .use_rustls_tls()
            .connect_timeout(Duration::from_secs(10));

        // 超时
        if let Some(timeout) = timeout_secs {
            builder = builder.timeout(Duration::from_secs(timeout));
        } else {
            builder = builder.timeout(Duration::from_secs(60));
        }

        // 设置代理
        match proxy_type {
            ProxyType::NoProxy => {
                builder = builder.no_proxy();
            }
            ProxyType::SelfProxy => {
                let port = Config::verge()
                    .latest()
                    .verge_mixed_port
                    .unwrap_or(Config::clash().data().get_mixed_port());

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
            ProxyType::SystemProxy => {
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

        // 证书验证选项
        builder = builder.danger_accept_invalid_certs(accept_invalid_certs);

        // 用户代理
        if let Some(ua) = user_agent {
            builder = builder.user_agent(ua);
        } else {
            use crate::utils::resolve::VERSION;

            let version = match VERSION.get() {
                Some(v) => format!("clash-verge/v{}", v),
                None => "clash-verge/unknown".to_string(),
            };

            builder = builder.user_agent(version);
        }

        // 构建请求
        let client = builder.build().expect("Failed to build custom HTTP client");

        client.get(url)
    }

    /// 执行GET请求
    pub async fn get(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<Response> {
        self.create_request(
            url,
            proxy_type,
            timeout_secs,
            user_agent,
            accept_invalid_certs,
        )
        .send()
        .await
        .context("Failed to send HTTP request")
    }
}

/// 代理类型
#[derive(Debug, Clone, Copy)]
pub enum ProxyType {
    NoProxy,
    SelfProxy,
    SystemProxy,
}

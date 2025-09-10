use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Duration, sleep, timeout};
use tokio_stream::{StreamExt, wrappers::UnboundedReceiverStream};

use crate::config::{Config, IVerge};
use crate::core::async_proxy_query::AsyncProxyQuery;
use crate::logging_error;
use crate::process::AsyncHandler;
use crate::utils::logging::Type;
use once_cell::sync::Lazy;
use sysproxy::{Autoproxy, Sysproxy};

#[derive(Debug, Clone)]
pub enum ProxyEvent {
    /// 配置变更事件
    ConfigChanged,
    /// 强制检查代理状态
    #[allow(dead_code)]
    ForceCheck,
    /// 启用系统代理
    #[allow(dead_code)]
    EnableProxy,
    /// 禁用系统代理
    #[allow(dead_code)]
    DisableProxy,
    /// 切换到PAC模式
    #[allow(dead_code)]
    SwitchToPac,
    /// 切换到HTTP代理模式
    #[allow(dead_code)]
    SwitchToHttp,
    /// 应用启动事件
    AppStarted,
    /// 应用关闭事件
    #[allow(dead_code)]
    AppStopping,
}

#[derive(Debug, Clone)]
pub struct ProxyState {
    pub sys_enabled: bool,
    pub pac_enabled: bool,
    pub auto_proxy: Autoproxy,
    pub sys_proxy: Sysproxy,
    pub last_updated: std::time::Instant,
    pub is_healthy: bool,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            sys_enabled: false,
            pac_enabled: false,
            auto_proxy: Autoproxy {
                enable: false,
                url: "".to_string(),
            },
            sys_proxy: Sysproxy {
                enable: false,
                host: "127.0.0.1".to_string(),
                port: 7897,
                bypass: "".to_string(),
            },
            last_updated: std::time::Instant::now(),
            is_healthy: true,
        }
    }
}

pub struct EventDrivenProxyManager {
    state: Arc<RwLock<ProxyState>>,
    event_sender: mpsc::UnboundedSender<ProxyEvent>,
    query_sender: mpsc::UnboundedSender<QueryRequest>,
}

#[derive(Debug)]
pub struct QueryRequest {
    response_tx: oneshot::Sender<Autoproxy>,
}

// 配置结构体移到外部
struct ProxyConfig {
    sys_enabled: bool,
    pac_enabled: bool,
    guard_enabled: bool,
}

static PROXY_MANAGER: Lazy<EventDrivenProxyManager> = Lazy::new(EventDrivenProxyManager::new);

impl EventDrivenProxyManager {
    pub fn global() -> &'static EventDrivenProxyManager {
        &PROXY_MANAGER
    }

    fn new() -> Self {
        let state = Arc::new(RwLock::new(ProxyState::default()));
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (query_tx, query_rx) = mpsc::unbounded_channel();

        let state_clone = Arc::clone(&state);
        AsyncHandler::spawn(move || Self::start_event_loop(state_clone, event_rx, query_rx));

        Self {
            state,
            event_sender: event_tx,
            query_sender: query_tx,
        }
    }

    /// 获取自动代理配置（缓存）
    pub async fn get_auto_proxy_cached(&self) -> Autoproxy {
        self.state.read().await.auto_proxy.clone()
    }

    /// 异步获取最新的自动代理配置
    pub async fn get_auto_proxy_async(&self) -> Autoproxy {
        let (tx, rx) = oneshot::channel();
        let query = QueryRequest { response_tx: tx };

        if self.query_sender.send(query).is_err() {
            log::error!(target: "app", "发送查询请求失败，返回缓存数据");
            return self.get_auto_proxy_cached().await;
        }

        match timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            _ => {
                log::warn!(target: "app", "查询超时，返回缓存数据");
                self.get_auto_proxy_cached().await
            }
        }
    }

    /// 通知配置变更
    pub fn notify_config_changed(&self) {
        self.send_event(ProxyEvent::ConfigChanged);
    }

    /// 通知应用启动
    pub fn notify_app_started(&self) {
        self.send_event(ProxyEvent::AppStarted);
    }

    /// 通知应用即将关闭
    #[allow(dead_code)]
    pub fn notify_app_stopping(&self) {
        self.send_event(ProxyEvent::AppStopping);
    }

    /// 启用系统代理
    #[allow(dead_code)]
    pub fn enable_proxy(&self) {
        self.send_event(ProxyEvent::EnableProxy);
    }

    /// 禁用系统代理
    #[allow(dead_code)]
    pub fn disable_proxy(&self) {
        self.send_event(ProxyEvent::DisableProxy);
    }

    /// 强制检查代理状态
    #[allow(dead_code)]
    pub fn force_check(&self) {
        self.send_event(ProxyEvent::ForceCheck);
    }

    fn send_event(&self, event: ProxyEvent) {
        if let Err(e) = self.event_sender.send(event) {
            log::error!(target: "app", "发送代理事件失败: {e}");
        }
    }

    pub async fn start_event_loop(
        state: Arc<RwLock<ProxyState>>,
        event_rx: mpsc::UnboundedReceiver<ProxyEvent>,
        query_rx: mpsc::UnboundedReceiver<QueryRequest>,
    ) {
        log::info!(target: "app", "事件驱动代理管理器启动");

        // 将 mpsc 接收器包装成 Stream，避免每次循环创建 future
        let mut event_stream = UnboundedReceiverStream::new(event_rx);
        let mut query_stream = UnboundedReceiverStream::new(query_rx);

        loop {
            tokio::select! {
                Some(event) = event_stream.next() => {
                    log::debug!(target: "app", "处理代理事件: {event:?}");
                    Self::handle_event(&state, event).await;
                }
                Some(query) = query_stream.next() => {
                    let result = Self::handle_query(&state).await;
                    let _ = query.response_tx.send(result);
                }
                else => {
                    // 两个通道都关闭时退出
                    log::info!(target: "app", "事件或查询通道关闭，代理管理器停止");
                    break;
                }
            }
        }
    }

    async fn handle_event(state: &Arc<RwLock<ProxyState>>, event: ProxyEvent) {
        match event {
            ProxyEvent::ConfigChanged | ProxyEvent::ForceCheck => {
                Self::update_proxy_config(state).await;
            }
            ProxyEvent::EnableProxy => {
                Self::enable_system_proxy(state).await;
            }
            ProxyEvent::DisableProxy => {
                Self::disable_system_proxy(state);
            }
            ProxyEvent::SwitchToPac => {
                Self::switch_proxy_mode(state, true).await;
            }
            ProxyEvent::SwitchToHttp => {
                Self::switch_proxy_mode(state, false).await;
            }
            ProxyEvent::AppStarted => {
                Self::initialize_proxy_state(state).await;
            }
            ProxyEvent::AppStopping => {
                log::info!(target: "app", "清理代理状态");
            }
        }
    }

    async fn handle_query(state: &Arc<RwLock<ProxyState>>) -> Autoproxy {
        let auto_proxy = Self::get_auto_proxy_with_timeout().await;

        Self::update_state_timestamp(state, |s| {
            s.auto_proxy = auto_proxy.clone();
        })
        .await;

        auto_proxy
    }

    async fn initialize_proxy_state(state: &Arc<RwLock<ProxyState>>) {
        log::info!(target: "app", "初始化代理状态");

        let config = Self::get_proxy_config().await;
        let auto_proxy = Self::get_auto_proxy_with_timeout().await;
        let sys_proxy = Self::get_sys_proxy_with_timeout().await;

        Self::update_state_timestamp(state, |s| {
            s.sys_enabled = config.sys_enabled;
            s.pac_enabled = config.pac_enabled;
            s.auto_proxy = auto_proxy;
            s.sys_proxy = sys_proxy;
            s.is_healthy = true;
        })
        .await;

        log::info!(target: "app", "代理状态初始化完成: sys={}, pac={}", config.sys_enabled, config.pac_enabled);
    }

    async fn update_proxy_config(state: &Arc<RwLock<ProxyState>>) {
        log::debug!(target: "app", "更新代理配置");

        let config = Self::get_proxy_config().await;

        Self::update_state_timestamp(state, |s| {
            s.sys_enabled = config.sys_enabled;
            s.pac_enabled = config.pac_enabled;
        })
        .await;

        if config.guard_enabled && config.sys_enabled {
            Self::check_and_restore_proxy(state).await;
        }
    }

    async fn check_and_restore_proxy(state: &Arc<RwLock<ProxyState>>) {
        let (sys_enabled, pac_enabled) = {
            let s = state.read().await;
            (s.sys_enabled, s.pac_enabled)
        };

        if !sys_enabled {
            return;
        }

        log::debug!(target: "app", "检查代理状态");

        if pac_enabled {
            Self::check_and_restore_pac_proxy(state).await;
        } else {
            Self::check_and_restore_sys_proxy(state).await;
        }
    }

    async fn check_and_restore_pac_proxy(state: &Arc<RwLock<ProxyState>>) {
        let current = Self::get_auto_proxy_with_timeout().await;
        let expected = Self::get_expected_pac_config().await;

        Self::update_state_timestamp(state, |s| {
            s.auto_proxy = current.clone();
        })
        .await;

        if !current.enable || current.url != expected.url {
            log::info!(target: "app", "PAC代理设置异常，正在恢复...");
            if let Err(e) = Self::restore_pac_proxy(&expected.url).await {
                log::error!(target: "app", "恢复PAC代理失败: {}", e);
            }

            sleep(Duration::from_millis(500)).await;
            let restored = Self::get_auto_proxy_with_timeout().await;

            Self::update_state_timestamp(state, |s| {
                s.is_healthy = restored.enable && restored.url == expected.url;
                s.auto_proxy = restored;
            })
            .await;
        }
    }

    async fn check_and_restore_sys_proxy(state: &Arc<RwLock<ProxyState>>) {
        let current = Self::get_sys_proxy_with_timeout().await;
        let expected = Self::get_expected_sys_proxy().await;

        Self::update_state_timestamp(state, |s| {
            s.sys_proxy = current.clone();
        })
        .await;

        if !current.enable || current.host != expected.host || current.port != expected.port {
            log::info!(target: "app", "系统代理设置异常，正在恢复...");
            if let Err(e) = Self::restore_sys_proxy(&expected).await {
                log::error!(target: "app", "恢复系统代理失败: {}", e);
            }

            sleep(Duration::from_millis(500)).await;
            let restored = Self::get_sys_proxy_with_timeout().await;

            Self::update_state_timestamp(state, |s| {
                s.is_healthy = restored.enable
                    && restored.host == expected.host
                    && restored.port == expected.port;
                s.sys_proxy = restored;
            })
            .await;
        }
    }

    async fn enable_system_proxy(state: &Arc<RwLock<ProxyState>>) {
        log::info!(target: "app", "启用系统代理");

        let pac_enabled = state.read().await.pac_enabled;

        if pac_enabled {
            let expected = Self::get_expected_pac_config().await;
            if let Err(e) = Self::restore_pac_proxy(&expected.url).await {
                log::error!(target: "app", "启用PAC代理失败: {}", e);
            }
        } else {
            let expected = Self::get_expected_sys_proxy().await;
            if let Err(e) = Self::restore_sys_proxy(&expected).await {
                log::error!(target: "app", "启用系统代理失败: {}", e);
            }
        }

        Self::check_and_restore_proxy(state).await;
    }

    fn disable_system_proxy(_state: &Arc<RwLock<ProxyState>>) {
        log::info!(target: "app", "禁用系统代理");

        #[cfg(not(target_os = "windows"))]
        {
            let disabled_sys = Sysproxy::default();
            let disabled_auto = Autoproxy::default();

            logging_error!(Type::System, true, disabled_auto.set_auto_proxy());
            logging_error!(Type::System, true, disabled_sys.set_system_proxy());
        }
    }

    async fn switch_proxy_mode(state: &Arc<RwLock<ProxyState>>, to_pac: bool) {
        log::info!(target: "app", "切换到{}模式", if to_pac { "PAC" } else { "HTTP代理" });

        if to_pac {
            let disabled_sys = Sysproxy::default();
            logging_error!(Type::System, true, disabled_sys.set_system_proxy());

            let expected = Self::get_expected_pac_config().await;
            if let Err(e) = Self::restore_pac_proxy(&expected.url).await {
                log::error!(target: "app", "切换到PAC模式失败: {}", e);
            }
        } else {
            let disabled_auto = Autoproxy::default();
            logging_error!(Type::System, true, disabled_auto.set_auto_proxy());

            let expected = Self::get_expected_sys_proxy().await;
            if let Err(e) = Self::restore_sys_proxy(&expected).await {
                log::error!(target: "app", "切换到HTTP代理模式失败: {}", e);
            }
        }

        Self::update_state_timestamp(state, |s| s.pac_enabled = to_pac).await;
        Self::check_and_restore_proxy(state).await;
    }

    async fn get_auto_proxy_with_timeout() -> Autoproxy {
        let async_proxy = AsyncProxyQuery::get_auto_proxy().await;

        // 转换为兼容的结构
        Autoproxy {
            enable: async_proxy.enable,
            url: async_proxy.url,
        }
    }

    async fn get_sys_proxy_with_timeout() -> Sysproxy {
        let async_proxy = AsyncProxyQuery::get_system_proxy().await;

        // 转换为兼容的结构
        Sysproxy {
            enable: async_proxy.enable,
            host: async_proxy.host,
            port: async_proxy.port,
            bypass: async_proxy.bypass,
        }
    }

    // 统一的状态更新方法
    async fn update_state_timestamp<F>(state: &Arc<RwLock<ProxyState>>, update_fn: F)
    where
        F: FnOnce(&mut ProxyState),
    {
        let mut state_guard = state.write().await;
        update_fn(&mut state_guard);
        state_guard.last_updated = std::time::Instant::now();
    }

    async fn get_proxy_config() -> ProxyConfig {
        let (sys_enabled, pac_enabled, guard_enabled) = {
            let verge_config = Config::verge().await;
            let verge = verge_config.latest_ref();
            (
                verge.enable_system_proxy.unwrap_or(false),
                verge.proxy_auto_config.unwrap_or(false),
                verge.enable_proxy_guard.unwrap_or(false),
            )
        };
        ProxyConfig {
            sys_enabled,
            pac_enabled,
            guard_enabled,
        }
    }

    async fn get_expected_pac_config() -> Autoproxy {
        let proxy_host = {
            let verge_config = Config::verge().await;
            let verge = verge_config.latest_ref();
            verge
                .proxy_host
                .clone()
                .unwrap_or_else(|| "127.0.0.1".to_string())
        };
        let pac_port = IVerge::get_singleton_port();
        Autoproxy {
            enable: true,
            url: format!("http://{proxy_host}:{pac_port}/commands/pac"),
        }
    }

    async fn get_expected_sys_proxy() -> Sysproxy {
        let verge_config = Config::verge().await;
        let verge_mixed_port = verge_config.latest_ref().verge_mixed_port;
        let proxy_host = verge_config.latest_ref().proxy_host.clone();

        let port = verge_mixed_port.unwrap_or(Config::clash().await.latest_ref().get_mixed_port());
        let proxy_host = proxy_host.unwrap_or_else(|| "127.0.0.1".to_string());

        Sysproxy {
            enable: true,
            host: proxy_host,
            port,
            bypass: Self::get_bypass_config().await,
        }
    }

    async fn get_bypass_config() -> String {
        let (use_default, custom_bypass) = {
            let verge_config = Config::verge().await;
            let verge = verge_config.latest_ref();
            (
                verge.use_default_bypass.unwrap_or(true),
                verge.system_proxy_bypass.clone().unwrap_or_default(),
            )
        };

        #[cfg(target_os = "windows")]
        let default_bypass = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";

        #[cfg(target_os = "linux")]
        let default_bypass =
            "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";

        #[cfg(target_os = "macos")]
        let default_bypass = "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";

        if custom_bypass.is_empty() {
            default_bypass.to_string()
        } else if use_default {
            format!("{default_bypass},{custom_bypass}")
        } else {
            custom_bypass
        }
    }

    #[cfg(target_os = "windows")]
    async fn restore_pac_proxy(expected_url: &str) -> Result<(), anyhow::Error> {
        Self::execute_sysproxy_command(&["pac", expected_url]).await
    }

    #[allow(clippy::unused_async)]
    #[cfg(not(target_os = "windows"))]
    async fn restore_pac_proxy(expected_url: &str) -> Result<(), anyhow::Error> {
        {
            let new_autoproxy = Autoproxy {
                enable: true,
                url: expected_url.to_string(),
            };
            // logging_error!(Type::System, true, new_autoproxy.set_auto_proxy());
            new_autoproxy
                .set_auto_proxy()
                .map_err(|e| anyhow::anyhow!("Failed to set auto proxy: {}", e))
        }
    }

    #[cfg(target_os = "windows")]
    async fn restore_sys_proxy(expected: &Sysproxy) -> Result<(), anyhow::Error> {
        let address = format!("{}:{}", expected.host, expected.port);
        Self::execute_sysproxy_command(&["global", &address, &expected.bypass]).await
    }

    #[allow(clippy::unused_async)]
    #[cfg(not(target_os = "windows"))]
    async fn restore_sys_proxy(expected: &Sysproxy) -> Result<(), anyhow::Error> {
        {
            // logging_error!(Type::System, true, expected.set_system_proxy());
            expected
                .set_system_proxy()
                .map_err(|e| anyhow::anyhow!("Failed to set system proxy: {}", e))
        }
    }

    #[cfg(target_os = "windows")]
    async fn execute_sysproxy_command(args: &[&str]) -> Result<(), anyhow::Error> {
        use crate::utils::dirs;
        #[allow(unused_imports)] // creation_flags必须
        use std::os::windows::process::CommandExt;
        use tokio::process::Command;

        let binary_path = match dirs::service_path() {
            Ok(path) => path,
            Err(e) => {
                log::error!(target: "app", "获取服务路径失败: {e}");
                return Err(e);
            }
        };

        let sysproxy_exe = binary_path.with_file_name("sysproxy.exe");
        if !sysproxy_exe.exists() {
            log::error!(target: "app", "sysproxy.exe 不存在");
        }
        anyhow::ensure!(sysproxy_exe.exists(), "sysproxy.exe does not exist");

        let _output = Command::new(sysproxy_exe)
            .args(args)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW - 隐藏窗口
            .output()
            .await?;

        Ok(())
    }
}

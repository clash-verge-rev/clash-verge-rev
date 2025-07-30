use parking_lot::RwLock;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep, timeout, Duration};

use crate::config::{Config, IVerge};
use crate::core::async_proxy_query::AsyncProxyQuery;
use crate::logging_error;
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
struct QueryRequest {
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

        Self::start_event_loop(state.clone(), event_rx, query_rx);

        Self {
            state,
            event_sender: event_tx,
            query_sender: query_tx,
        }
    }

    /// 获取自动代理配置（缓存）
    pub fn get_auto_proxy_cached(&self) -> Autoproxy {
        self.state.read().auto_proxy.clone()
    }

    /// 异步获取最新的自动代理配置
    pub async fn get_auto_proxy_async(&self) -> Autoproxy {
        let (tx, rx) = oneshot::channel();
        let query = QueryRequest { response_tx: tx };

        if self.query_sender.send(query).is_err() {
            log::error!(target: "app", "发送查询请求失败，返回缓存数据");
            return self.get_auto_proxy_cached();
        }

        match timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            _ => {
                log::warn!(target: "app", "查询超时，返回缓存数据");
                self.get_auto_proxy_cached()
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

    fn start_event_loop(
        state: Arc<RwLock<ProxyState>>,
        mut event_rx: mpsc::UnboundedReceiver<ProxyEvent>,
        mut query_rx: mpsc::UnboundedReceiver<QueryRequest>,
    ) {
        tokio::spawn(async move {
            log::info!(target: "app", "事件驱动代理管理器启动");

            loop {
                tokio::select! {
                    event = event_rx.recv() => {
                        match event {
                            Some(event) => {
                                log::debug!(target: "app", "处理代理事件: {event:?}");
                                Self::handle_event(&state, event).await;
                            }
                            None => {
                                log::info!(target: "app", "事件通道关闭，代理管理器停止");
                                break;
                            }
                        }
                    }
                    query = query_rx.recv() => {
                        match query {
                            Some(query) => {
                                let result = Self::handle_query(&state).await;
                                let _ = query.response_tx.send(result);
                            }
                            None => {
                                log::info!(target: "app", "查询通道关闭");
                                break;
                            }
                        }
                    }
                }
            }
        });
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
                Self::disable_system_proxy(state).await;
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
        });

        auto_proxy
    }

    async fn initialize_proxy_state(state: &Arc<RwLock<ProxyState>>) {
        log::info!(target: "app", "初始化代理状态");

        let config = Self::get_proxy_config();
        let auto_proxy = Self::get_auto_proxy_with_timeout().await;
        let sys_proxy = Self::get_sys_proxy_with_timeout().await;

        Self::update_state_timestamp(state, |s| {
            s.sys_enabled = config.sys_enabled;
            s.pac_enabled = config.pac_enabled;
            s.auto_proxy = auto_proxy;
            s.sys_proxy = sys_proxy;
            s.is_healthy = true;
        });

        log::info!(target: "app", "代理状态初始化完成: sys={}, pac={}", config.sys_enabled, config.pac_enabled);
    }

    async fn update_proxy_config(state: &Arc<RwLock<ProxyState>>) {
        log::debug!(target: "app", "更新代理配置");

        let config = Self::get_proxy_config();

        Self::update_state_timestamp(state, |s| {
            s.sys_enabled = config.sys_enabled;
            s.pac_enabled = config.pac_enabled;
        });

        if config.guard_enabled && config.sys_enabled {
            Self::check_and_restore_proxy(state).await;
        }
    }

    async fn check_and_restore_proxy(state: &Arc<RwLock<ProxyState>>) {
        let (sys_enabled, pac_enabled) = {
            let s = state.read();
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
        let expected = Self::get_expected_pac_config();

        Self::update_state_timestamp(state, |s| {
            s.auto_proxy = current.clone();
        });

        if !current.enable || current.url != expected.url {
            log::info!(target: "app", "PAC代理设置异常，正在恢复...");
            Self::restore_pac_proxy(&expected.url).await;

            sleep(Duration::from_millis(500)).await;
            let restored = Self::get_auto_proxy_with_timeout().await;

            Self::update_state_timestamp(state, |s| {
                s.is_healthy = restored.enable && restored.url == expected.url;
                s.auto_proxy = restored;
            });
        }
    }

    async fn check_and_restore_sys_proxy(state: &Arc<RwLock<ProxyState>>) {
        let current = Self::get_sys_proxy_with_timeout().await;
        let expected = Self::get_expected_sys_proxy();

        Self::update_state_timestamp(state, |s| {
            s.sys_proxy = current.clone();
        });

        if !current.enable || current.host != expected.host || current.port != expected.port {
            log::info!(target: "app", "系统代理设置异常，正在恢复...");
            Self::restore_sys_proxy(&expected).await;

            sleep(Duration::from_millis(500)).await;
            let restored = Self::get_sys_proxy_with_timeout().await;

            Self::update_state_timestamp(state, |s| {
                s.is_healthy = restored.enable
                    && restored.host == expected.host
                    && restored.port == expected.port;
                s.sys_proxy = restored;
            });
        }
    }

    async fn enable_system_proxy(state: &Arc<RwLock<ProxyState>>) {
        log::info!(target: "app", "启用系统代理");

        let pac_enabled = state.read().pac_enabled;

        if pac_enabled {
            let expected = Self::get_expected_pac_config();
            Self::restore_pac_proxy(&expected.url).await;
        } else {
            let expected = Self::get_expected_sys_proxy();
            Self::restore_sys_proxy(&expected).await;
        }

        Self::check_and_restore_proxy(state).await;
    }

    async fn disable_system_proxy(_state: &Arc<RwLock<ProxyState>>) {
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

            let expected = Self::get_expected_pac_config();
            Self::restore_pac_proxy(&expected.url).await;
        } else {
            let disabled_auto = Autoproxy::default();
            logging_error!(Type::System, true, disabled_auto.set_auto_proxy());

            let expected = Self::get_expected_sys_proxy();
            Self::restore_sys_proxy(&expected).await;
        }

        Self::update_state_timestamp(state, |s| s.pac_enabled = to_pac);
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
    fn update_state_timestamp<F>(state: &Arc<RwLock<ProxyState>>, update_fn: F)
    where
        F: FnOnce(&mut ProxyState),
    {
        let mut state_guard = state.write();
        update_fn(&mut state_guard);
        state_guard.last_updated = std::time::Instant::now();
    }

    fn get_proxy_config() -> ProxyConfig {
        let (sys_enabled, pac_enabled, guard_enabled) = {
            let verge_config = Config::verge();
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

    fn get_expected_pac_config() -> Autoproxy {
        let proxy_host = {
            let verge_config = Config::verge();
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

    fn get_expected_sys_proxy() -> Sysproxy {
        let verge_config = Config::verge();
        let verge = verge_config.latest_ref();
        let port = verge
            .verge_mixed_port
            .unwrap_or(Config::clash().latest_ref().get_mixed_port());
        let proxy_host = verge
            .proxy_host
            .clone()
            .unwrap_or_else(|| "127.0.0.1".to_string());

        Sysproxy {
            enable: true,
            host: proxy_host,
            port,
            bypass: Self::get_bypass_config(),
        }
    }

    fn get_bypass_config() -> String {
        let (use_default, custom_bypass) = {
            let verge_config = Config::verge();
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

    async fn restore_pac_proxy(expected_url: &str) {
        #[cfg(not(target_os = "windows"))]
        {
            let new_autoproxy = Autoproxy {
                enable: true,
                url: expected_url.to_string(),
            };
            logging_error!(Type::System, true, new_autoproxy.set_auto_proxy());
        }

        #[cfg(target_os = "windows")]
        {
            Self::execute_sysproxy_command(&["pac", expected_url]).await;
        }
    }

    async fn restore_sys_proxy(expected: &Sysproxy) {
        #[cfg(not(target_os = "windows"))]
        {
            logging_error!(Type::System, true, expected.set_system_proxy());
        }

        #[cfg(target_os = "windows")]
        {
            let address = format!("{}:{}", expected.host, expected.port);
            Self::execute_sysproxy_command(&["global", &address, &expected.bypass]).await;
        }
    }

    #[cfg(target_os = "windows")]
    async fn execute_sysproxy_command(args: &[&str]) {
        use crate::utils::dirs;
        #[allow(unused_imports)] // creation_flags必须
        use std::os::windows::process::CommandExt;
        use tokio::process::Command;

        let binary_path = match dirs::service_path() {
            Ok(path) => path,
            Err(e) => {
                log::error!(target: "app", "获取服务路径失败: {e}");
                return;
            }
        };

        let sysproxy_exe = binary_path.with_file_name("sysproxy.exe");
        if !sysproxy_exe.exists() {
            log::error!(target: "app", "sysproxy.exe 不存在");
            return;
        }

        let output = Command::new(sysproxy_exe)
            .args(args)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW - 隐藏窗口
            .output()
            .await;

        match output {
            Ok(output) => {
                if !output.status.success() {
                    log::error!(target: "app", "执行sysproxy命令失败: {args:?}");
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if !stderr.is_empty() {
                        log::error!(target: "app", "sysproxy错误输出: {stderr}");
                    }
                } else {
                    log::debug!(target: "app", "成功执行sysproxy命令: {args:?}");
                }
            }
            Err(e) => {
                log::error!(target: "app", "执行sysproxy命令出错: {e}");
            }
        }
    }
}

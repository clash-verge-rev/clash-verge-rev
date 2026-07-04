use std::time::Duration;

pub mod network {
    pub const DEFAULT_EXTERNAL_CONTROLLER: &str = "127.0.0.1:9097";

    pub mod ports {
        #[cfg(not(target_os = "windows"))]
        pub const DEFAULT_REDIR: u16 = 7895;
        #[cfg(target_os = "linux")]
        pub const DEFAULT_TPROXY: u16 = 7896;
        pub const DEFAULT_MIXED: u16 = 7897;
        pub const DEFAULT_SOCKS: u16 = 7898;
        pub const DEFAULT_HTTP: u16 = 7899;

        #[cfg(not(feature = "verge-dev"))]
        pub const SINGLETON_SERVER: u16 = 33331;
        #[cfg(feature = "verge-dev")]
        pub const SINGLETON_SERVER: u16 = 11233;
    }
}

pub mod timing {
    use super::Duration;

    pub const CONFIG_UPDATE_DEBOUNCE: Duration = Duration::from_millis(300);
    pub const STARTUP_ERROR_DELAY: Duration = Duration::from_secs(2);

    // Windows 服务冷启动较慢,避免过早回退 sidecar。
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_MAX: Duration = Duration::from_millis(30000);
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_INTERVAL: Duration = Duration::from_millis(200);

    // 回退 sidecar 后继续等待服务就绪并尝试交接。
    #[cfg(target_os = "windows")]
    pub const SERVICE_HANDOFF_WINDOW: Duration = Duration::from_secs(120);
    #[cfg(target_os = "windows")]
    pub const SERVICE_HANDOFF_INTERVAL: Duration = Duration::from_secs(2);

    // 交接时等待 sidecar 释放 ext-controller 通道。
    #[cfg(target_os = "windows")]
    pub const SERVICE_START_RETRIES: usize = 5;
    #[cfg(target_os = "windows")]
    pub const SERVICE_START_RETRY_DELAY: Duration = Duration::from_millis(300);
}

pub mod files {
    pub const RUNTIME_CONFIG: &str = "clash-verge.yaml";
    pub const CHECK_CONFIG: &str = "clash-verge-check.yaml";
    pub const DNS_CONFIG: &str = "dns_config.yaml";
    pub const WINDOW_STATE: &str = "window_state.json";
}

pub mod tun {
    pub const DEFAULT_STACK: &str = "gvisor";

    pub const DNS_HIJACK: &[&str] = &["any:53"];
}

use std::time::Duration;

pub mod network {
    pub const DEFAULT_PROXY_HOST: &str = "127.0.0.1";
    pub const DEFAULT_EXTERNAL_CONTROLLER: &str = "127.0.0.1:9097";
    
    pub mod ports {
        #[allow(dead_code)]
        pub const DEFAULT_REDIR: u16 = 7895;
        #[allow(dead_code)]
        pub const DEFAULT_TPROXY: u16 = 7896;
        pub const DEFAULT_MIXED: u16 = 7897;
        pub const DEFAULT_SOCKS: u16 = 7898;
        pub const DEFAULT_HTTP: u16 = 7899;
        #[allow(dead_code)]
        pub const DEFAULT_EXTERNAL_CONTROLLER: u16 = 9097;
        
        #[cfg(not(feature = "verge-dev"))]
        pub const SINGLETON_SERVER: u16 = 33331;
        #[cfg(feature = "verge-dev")]
        pub const SINGLETON_SERVER: u16 = 11233;
    }
}

pub mod bypass {
    #[cfg(target_os = "windows")]
    pub const DEFAULT: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
    
    #[cfg(target_os = "linux")]
    pub const DEFAULT: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";
    
    #[cfg(target_os = "macos")]
    pub const DEFAULT: &str = "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";
}

pub mod timing {
    use super::Duration;
    
    pub const CONFIG_UPDATE_DEBOUNCE: Duration = Duration::from_millis(500);
    pub const CONFIG_RELOAD_DELAY: Duration = Duration::from_millis(300);
    pub const PROCESS_VERIFY_DELAY: Duration = Duration::from_millis(100);
    #[allow(dead_code)]
    pub const EVENT_EMIT_DELAY: Duration = Duration::from_millis(20);
    pub const STARTUP_ERROR_DELAY: Duration = Duration::from_secs(2);
    #[allow(dead_code)]
    pub const ERROR_BATCH_DELAY: Duration = Duration::from_millis(300);
    
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_MAX: Duration = Duration::from_millis(3000);
    #[cfg(target_os = "windows")]
    pub const SERVICE_WAIT_INTERVAL: Duration = Duration::from_millis(200);
}

pub mod retry {
    #[allow(dead_code)]
    pub const EVENT_EMIT_THRESHOLD: u64 = 10;
    #[allow(dead_code)]
    pub const SWR_ERROR_RETRY: usize = 2;
}

pub mod files {
    pub const RUNTIME_CONFIG: &str = "clash-verge.yaml";
    pub const CHECK_CONFIG: &str = "clash-verge-check.yaml";
    #[allow(dead_code)]
    pub const DNS_CONFIG: &str = "dns_config.yaml";
    #[allow(dead_code)]
    pub const WINDOW_STATE: &str = "window_state.json";
}

pub mod process {
    pub const VERGE_MIHOMO: &str = "verge-mihomo";
    pub const VERGE_MIHOMO_ALPHA: &str = "verge-mihomo-alpha";
    
    pub fn process_names() -> [&'static str; 2] {
        [VERGE_MIHOMO, VERGE_MIHOMO_ALPHA]
    }
    
    #[cfg(windows)]
    pub fn with_extension(name: &str) -> String {
        format!("{}.exe", name)
    }
    
    #[cfg(not(windows))]
    pub fn with_extension(name: &str) -> String {
        name.to_string()
    }
}

pub mod error_patterns {
    pub const CONNECTION_ERRORS: &[&str] = &[
        "Failed to create connection",
        "The system cannot find the file specified",
        "operation timed out",
        "connection refused",
    ];
}

pub mod tun {
    #[cfg(target_os = "linux")]
    pub const DEFAULT_STACK: &str = "mixed";
    
    #[cfg(not(target_os = "linux"))]
    pub const DEFAULT_STACK: &str = "gvisor";
    
    pub const DNS_HIJACK: &[&str] = &["any:53"];
}


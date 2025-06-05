pub struct CmdProxyState {
    pub last_refresh_time: std::time::Instant,
    pub need_refresh: bool,
    pub providers_proxies: serde_json::Value,
}

impl Default for CmdProxyState {
    fn default() -> Self {
        Self {
            last_refresh_time: std::time::Instant::now(),
            need_refresh: true,
            providers_proxies: serde_json::Value::Null,
        }
    }
}

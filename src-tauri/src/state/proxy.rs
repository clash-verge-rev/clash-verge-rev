use serde_json::Value;

pub struct CmdProxyState {
    pub last_refresh_time: std::time::Instant,
    pub need_refresh: bool,
    pub proxies: Box<Value>,
    pub providers_proxies: Box<Value>,
}

impl Default for CmdProxyState {
    fn default() -> Self {
        Self {
            last_refresh_time: std::time::Instant::now(),
            need_refresh: true,
            proxies: Box::new(Value::Null),
            providers_proxies: Box::new(Value::Null),
        }
    }
}

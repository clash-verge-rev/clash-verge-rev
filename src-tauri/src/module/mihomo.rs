use crate::config::Config;
use mihomo_api;
use once_cell::sync::{Lazy, OnceCell};
use std::sync::Mutex;
use tauri::http::{HeaderMap, HeaderValue};
#[cfg(target_os = "macos")]
use tokio_tungstenite::tungstenite::http;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rate {
    pub up: u64,
    pub down: u64,
}

pub struct MihomoManager {
    mihomo: Mutex<OnceCell<mihomo_api::MihomoManager>>,
}

impl MihomoManager {
    fn __global() -> &'static MihomoManager {
        static INSTANCE: Lazy<MihomoManager> = Lazy::new(|| MihomoManager {
            mihomo: Mutex::new(OnceCell::new()),
        });
        &INSTANCE
    }

    pub fn global() -> mihomo_api::MihomoManager {
        let instance = MihomoManager::__global();
        let (current_server, headers) = MihomoManager::get_clash_client_info().unwrap();

        let lock = instance.mihomo.lock().unwrap();
        if let Some(mihomo) = lock.get() {
            if mihomo.get_mihomo_server() == current_server {
                return mihomo.clone();
            }
        }

        lock.set(mihomo_api::MihomoManager::new(current_server, headers))
            .ok();
        lock.get().unwrap().clone()
    }
}

impl MihomoManager {
    pub fn get_clash_client_info() -> Option<(String, HeaderMap)> {
        let client = { Config::clash().data().get_client_info() };
        let server = format!("http://{}", client.server);
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse().unwrap());
        if let Some(secret) = client.secret {
            let secret = format!("Bearer {}", secret).parse().unwrap();
            headers.insert("Authorization", secret);
        }

        Some((server, headers))
    }
    #[cfg(target_os = "macos")]
    pub fn get_traffic_ws_url() -> (String, HeaderValue) {
        let (url, headers) = MihomoManager::get_clash_client_info().unwrap();
        let ws_url = url.replace("http://", "ws://") + "/traffic";
        let auth = headers
            .get("Authorization")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let token = http::header::HeaderValue::from_str(&auth).unwrap();
        (ws_url, token)
    }
}

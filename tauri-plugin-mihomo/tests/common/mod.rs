use std::sync::Arc;

use tauri_plugin_mihomo::{Mihomo, Protocol};

#[allow(dead_code)]
pub const TEST_URL: &str = "http://www.gstatic.com/generate_204";
#[allow(dead_code)]
pub const TIMEOUT: u32 = 3000;

pub fn mihomo() -> Mihomo {
    let mihomo_socket = std::env::var("MIHOMO_SOCKET").unwrap_or(String::from("0"));
    if mihomo_socket == "1" {
        // use local socket
        let socket_path = if cfg!(unix) {
            "/tmp/verge-mihomo.sock".to_string()
        } else {
            r"\\.\pipe\verge-mihomo".to_string()
        };
        Mihomo {
            protocol: Protocol::LocalSocket,
            external_host: None,
            external_port: None,
            secret: None,
            socket_path: Some(socket_path),
            connection_manager: Arc::new(Default::default()),
        }
    } else {
        // use http
        Mihomo {
            protocol: Protocol::Http,
            external_host: Some("127.0.0.1".into()),
            external_port: Some(9090),
            secret: Some("yPMJk9i7UaR1hv3-2BkPy".into()),
            socket_path: None,
            connection_manager: Arc::new(Default::default()),
        }
    }
}

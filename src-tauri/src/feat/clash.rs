use crate::{
    config::Config,
    core::{handle, tray, CoreManager},
    logging_error,
    module::mihomo::MihomoManager,
    process::AsyncHandler,
    utils::{logging::Type, resolve},
};
use serde_yaml::{Mapping, Value};
use tauri::Manager;

/// Restart the Clash core
pub fn restart_clash_core() {
    AsyncHandler::spawn(move || async move {
        match CoreManager::global().restart_core().await {
            Ok(_) => {
                handle::Handle::refresh_clash();
                handle::Handle::notice_message("set_config::ok", "ok");
            }
            Err(err) => {
                handle::Handle::notice_message("set_config::error", format!("{err}"));
                log::error!(target:"app", "{err}");
            }
        }
    });
}

/// Restart the application
pub fn restart_app() {
    AsyncHandler::spawn(move || async move {
        logging_error!(Type::Core, true, CoreManager::global().stop_core().await);
        resolve::resolve_reset_async().await;
        let app_handle = handle::Handle::global().app_handle().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        tauri::process::restart(&app_handle.env());
    });
}

fn after_change_clash_mode() {
    AsyncHandler::spawn(move || async {
        match MihomoManager::global().get_connections().await {
            Ok(connections) => {
                if let Some(connections_array) = connections["connections"].as_array() {
                    for connection in connections_array {
                        if let Some(id) = connection["id"].as_str() {
                            let _ = MihomoManager::global().delete_connection(id).await;
                        }
                    }
                }
            }
            Err(err) => {
                log::error!(target: "app", "Failed to get connections: {}", err);
            }
        }
    });
}

/// Change Clash mode (rule/global/direct/script)
pub fn change_clash_mode(mode: String) {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), mode.clone().into());
    // Convert YAML mapping to JSON Value
    let json_value = serde_json::json!({
        "mode": mode
    });
    AsyncHandler::spawn(move || async move {
        log::debug!(target: "app", "change clash mode to {mode}");
        match MihomoManager::global().patch_configs(json_value).await {
            Ok(_) => {
                // 更新订阅
                Config::clash().data().patch_config(mapping);

                if Config::clash().data().save_config().is_ok() {
                    handle::Handle::refresh_clash();
                    logging_error!(Type::Tray, true, tray::Tray::global().update_menu());
                    logging_error!(Type::Tray, true, tray::Tray::global().update_icon(None));
                }

                let is_auto_close_connection = Config::verge()
                    .data()
                    .auto_close_connection
                    .unwrap_or(false);
                if is_auto_close_connection {
                    after_change_clash_mode();
                }
            }
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

/// Test connection delay to a URL
pub async fn test_delay(url: String) -> anyhow::Result<u32> {
    use crate::utils::network::{NetworkManager, ProxyType};
    use tokio::time::Instant;

    let tun_mode = Config::verge().latest().enable_tun_mode.unwrap_or(false);

    // 如果是TUN模式，不使用代理，否则使用自身代理
    let proxy_type = if !tun_mode {
        ProxyType::Localhost
    } else {
        ProxyType::None
    };

    let user_agent = Some("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0".to_string());

    let start = Instant::now();

    let response = NetworkManager::global()
        .get_with_interrupt(&url, proxy_type, Some(10), user_agent, false)
        .await;

    match response {
        Ok(response) => {
            log::trace!(target: "app", "test_delay response: {:#?}", response);
            if response.status().is_success() {
                Ok(start.elapsed().as_millis() as u32)
            } else {
                Ok(10000u32)
            }
        }
        Err(err) => {
            log::trace!(target: "app", "test_delay error: {:#?}", err);
            Err(err)
        }
    }
}

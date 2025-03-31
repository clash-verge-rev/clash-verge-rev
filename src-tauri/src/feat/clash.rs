use crate::{
    config::Config,
    core::{handle, tray, CoreManager},
    logging_error,
    module::mihomo::MihomoManager,
    utils::{logging::Type, resolve},
};
use serde_yaml::{Mapping, Value};
use tauri::Manager;

/// Restart the Clash core
pub fn restart_clash_core() {
    tauri::async_runtime::spawn(async {
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
    tauri::async_runtime::spawn_blocking(|| {
        tauri::async_runtime::block_on(async {
            logging_error!(Type::Core, true, CoreManager::global().stop_core().await);
        });
        resolve::resolve_reset();
        let app_handle = handle::Handle::global().app_handle().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        tauri::process::restart(&app_handle.env());
    });
}

fn after_change_clash_mode() {
    let _ = tauri::async_runtime::block_on(tauri::async_runtime::spawn_blocking(|| {
        tauri::async_runtime::block_on(async {
            let connections = MihomoManager::global().get_connections().await.unwrap();
            let connections = connections["connections"].as_array().unwrap();
            for connection in connections {
                let id = connection["id"].as_str().unwrap();
                let _ = MihomoManager::global().delete_connection(id).await;
            }
        })
    }));
}

/// Change Clash mode (rule/global/direct/script)
pub fn change_clash_mode(mode: String) {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), mode.clone().into());
    // Convert YAML mapping to JSON Value
    let json_value = serde_json::json!({
        "mode": mode
    });
    tauri::async_runtime::spawn(async move {
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
            Err(err) => println!("{err}"),
        }
    });
}

/// Test connection delay to a URL
pub async fn test_delay(url: String) -> anyhow::Result<u32> {
    use tokio::time::{Duration, Instant};
    let mut builder = reqwest::ClientBuilder::new().use_rustls_tls().no_proxy();

    let port = Config::verge()
        .latest()
        .verge_mixed_port
        .unwrap_or(Config::clash().data().get_mixed_port());
    let tun_mode = Config::verge().latest().enable_tun_mode.unwrap_or(false);

    let proxy_scheme = format!("http://127.0.0.1:{port}");

    if !tun_mode {
        if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
            builder = builder.proxy(proxy);
        }
    }

    let request = builder
        .timeout(Duration::from_millis(10000))
        .build()?
        .get(url).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0");
    let start = Instant::now();

    let response = request.send().await;
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
            Err(err.into())
        }
    }
}

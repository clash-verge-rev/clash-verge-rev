use crate::{
    config::{Config, MixedPort},
    core::{CoreManager, handle, tray},
    feat::clean_async,
    process::AsyncHandler,
    utils,
};
use clash_verge_logging::{Type, logging};
use reqwest::{Client, Proxy};
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::time::Duration;
use tokio::time::Instant;

pub async fn restart_clash_core() {
    match CoreManager::global().restart_core().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            handle::Handle::notice_message("set_config::ok", "ok");
        }
        Err(err) => {
            handle::Handle::notice_message("set_config::error", format!("{err:#}"));
            logging!(error, Type::Core, "{err:#}");
        }
    }
}

pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    handle::Handle::global().set_is_exiting();

    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if !cleanup_result.core_stopped {
        handle::Handle::global().clear_is_exiting();
        handle::Handle::notice_message(
            "app_restart::core_stop_failed",
            cleanup_result.stop_error.unwrap_or_default(),
        );
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}

fn after_change_clash_mode() {
    AsyncHandler::spawn(move || async {
        let mihomo = handle::Handle::mihomo();
        match mihomo.get_connections().await {
            Ok(connections) => {
                if let Some(connections_array) = connections.connections {
                    for connection in connections_array {
                        let _ = mihomo.close_connection(&connection.id).await;
                    }
                }
            }
            Err(err) => {
                logging!(error, Type::Core, "Failed to get connections: {err}");
            }
        }
    });
}

/// Propagates mihomo PATCH failures so the frontend can roll back its optimistic mode.
pub async fn change_clash_mode(mode: String) -> Result<(), String> {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode.as_str()));
    let json_value = serde_json::json!({
        "mode": mode
    });
    logging!(debug, Type::Core, "change clash mode to {mode}");
    if let Err(err) = handle::Handle::mihomo().patch_base_config(&json_value).await {
        logging!(error, Type::Core, "{err}");
        return Err(err.to_string().into());
    }

    let clash = Config::clash().await;
    clash.edit_draft(|d| d.patch_config(&mapping));
    clash.apply();

    let clash_data = clash.data_arc();
    if clash_data.save_config().await.is_ok() {
        handle::Handle::refresh_clash();
        tray::Tray::global().update_menu_and_icon().await;
    }

    let is_auto_close_connection = Config::verge().await.data_arc().auto_close_connection.unwrap_or(false);
    if is_auto_close_connection {
        after_change_clash_mode();
    }

    Ok(())
}

/// Test delay to a URL through proxy.
pub async fn test_delay(url: String) -> anyhow::Result<u32> {
    let proxy_port = MixedPort::effective().await;
    let proxy = Proxy::all(format!("http://127.0.0.1:{proxy_port}"))?;

    let client = Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()?;

    let start = Instant::now();
    let resp = client.head(url.as_str()).send().await;
    match resp {
        Ok(_) => Ok((start.elapsed().as_millis() as u32).max(1)),
        Err(_) => {
            client.get(url.as_str()).send().await?;
            Ok((start.elapsed().as_millis() as u32).max(1))
        }
    }
}

use crate::{
    config::{Config, IVerge},
    core::handle,
};
use clash_verge_logging::{Type, logging};
use std::env;
use tauri_plugin_clipboard_manager::ClipboardExt as _;

/// Toggle system proxy on/off
pub async fn toggle_system_proxy() {
    let verge = Config::verge().await;
    let enable = verge.latest_arc().enable_system_proxy.unwrap_or(false);
    let auto_close_connection = verge.latest_arc().auto_close_connection.unwrap_or(false);

    // 如果当前系统代理即将关闭，且自动关闭连接设置为true，则关闭所有连接
    if enable
        && auto_close_connection
        && let Err(err) = handle::Handle::mihomo().await.close_all_connections().await
    {
        logging!(error, Type::ProxyMode, "Failed to close all connections: {err}");
    }

    let patch_result = super::patch_verge(
        &IVerge {
            enable_system_proxy: Some(!enable),
            ..IVerge::default()
        },
        false,
    )
    .await;

    match patch_result {
        Ok(_) => handle::Handle::refresh_verge(),
        Err(err) => logging!(error, Type::ProxyMode, "{err}"),
    }
}

/// Toggle TUN mode on/off
pub async fn toggle_tun_mode(not_save_file: Option<bool>) {
    let enable = Config::verge().await.latest_arc().enable_tun_mode;
    let enable = enable.unwrap_or(false);

    match super::patch_verge(
        &IVerge {
            enable_tun_mode: Some(!enable),
            ..IVerge::default()
        },
        not_save_file.unwrap_or(false),
    )
    .await
    {
        Ok(_) => handle::Handle::refresh_verge(),
        Err(err) => logging!(error, Type::ProxyMode, "{err}"),
    }
}

/// Copy proxy environment variables to clipboard
pub async fn copy_clash_env() {
    let env_ip = env::var("CLASH_VERGE_REV_IP").ok();
    let verge_cfg = Config::verge().await.latest_arc();
    let ip = env_ip
        .as_deref()
        .unwrap_or_else(|| verge_cfg.proxy_host.as_deref().unwrap_or("127.0.0.1"));

    let app_handle = handle::Handle::app_handle();
    let port = verge_cfg.verge_mixed_port.unwrap_or(7897);
    let http_proxy = format!("http://{ip}:{port}");
    let socks5_proxy = format!("socks5://{ip}:{port}");

    let clipboard = app_handle.clipboard();

    let default_env = {
        #[cfg(not(target_os = "windows"))]
        {
            "bash"
        }
        #[cfg(target_os = "windows")]
        {
            "powershell"
        }
    };
    let env_type = verge_cfg.env_type.as_deref().unwrap_or(default_env);

    let export_text = match env_type {
        "bash" => format!("export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}"),
        "cmd" => format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}"),
        "powershell" => {
            format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"")
        }
        "nushell" => {
            format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}")
        }
        "fish" => format!("set -x http_proxy {http_proxy}; set -x https_proxy {http_proxy}"),
        _ => {
            logging!(error, Type::ProxyMode, "copy_clash_env: Invalid env type! {env_type}");
            return;
        }
    };

    if clipboard.write_text(&export_text).is_err() {
        logging!(error, Type::ProxyMode, "Failed to write to clipboard");
    }
}

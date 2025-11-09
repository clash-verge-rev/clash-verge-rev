use crate::{
    config::{Config, IVerge},
    core::handle,
    logging,
    utils::logging::Type,
};
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
        logging!(
            error,
            Type::ProxyMode,
            "Failed to close all connections: {err}"
        );
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
    // 从环境变量获取IP地址，如果没有则从配置中获取 proxy_host，默认为 127.0.0.1
    let clash_verge_rev_ip = match env::var("CLASH_VERGE_REV_IP") {
        Ok(ip) => ip.into(),
        Err(_) => Config::verge()
            .await
            .latest_arc()
            .proxy_host
            .clone()
            .unwrap_or_else(|| "127.0.0.1".into()),
    };

    let app_handle = handle::Handle::app_handle();
    let port = {
        Config::verge()
            .await
            .latest_arc()
            .verge_mixed_port
            .unwrap_or(7897)
    };
    let http_proxy = format!("http://{clash_verge_rev_ip}:{port}");
    let socks5_proxy = format!("socks5://{clash_verge_rev_ip}:{port}");

    let cliboard = app_handle.clipboard();
    let env_type = { Config::verge().await.latest_arc().env_type.clone() };
    let env_type = match env_type {
        Some(env_type) => env_type,
        None => {
            #[cfg(not(target_os = "windows"))]
            let default = "bash";
            #[cfg(target_os = "windows")]
            let default = "powershell";

            default.into()
        }
    };

    let export_text = match env_type.as_str() {
        "bash" => format!(
            "export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}"
        ),
        "cmd" => format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}"),
        "powershell" => {
            format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"")
        }
        "nushell" => {
            format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}")
        }
        "fish" => format!("set -x http_proxy {http_proxy}; set -x https_proxy {http_proxy}"),
        _ => {
            logging!(
                error,
                Type::ProxyMode,
                "copy_clash_env: Invalid env type! {env_type}"
            );
            return;
        }
    };

    if cliboard.write_text(export_text).is_err() {
        logging!(error, Type::ProxyMode, "Failed to write to clipboard");
    }
}

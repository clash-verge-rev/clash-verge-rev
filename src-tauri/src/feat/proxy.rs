use crate::{
    config::{Config, IVerge},
    core::handle,
};
use std::env;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Toggle system proxy on/off
pub fn toggle_system_proxy() {
    let enable = Config::verge().draft().enable_system_proxy;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match super::patch_verge(
            IVerge {
                enable_system_proxy: Some(!enable),
                ..IVerge::default()
            },
            false,
        )
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

/// Toggle TUN mode on/off
pub fn toggle_tun_mode(not_save_file: Option<bool>) {
    let enable = Config::verge().data().enable_tun_mode;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match super::patch_verge(
            IVerge {
                enable_tun_mode: Some(!enable),
                ..IVerge::default()
            },
            not_save_file.unwrap_or(false),
        )
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

/// Copy proxy environment variables to clipboard
pub fn copy_clash_env() {
    // 从环境变量获取IP地址，默认127.0.0.1
    let clash_verge_rev_ip =
        env::var("CLASH_VERGE_REV_IP").unwrap_or_else(|_| "127.0.0.1".to_string());

    let app_handle = handle::Handle::global().app_handle().unwrap();
    let port = { Config::verge().latest().verge_mixed_port.unwrap_or(7897) };
    let http_proxy = format!("http://{clash_verge_rev_ip}:{}", port);
    let socks5_proxy = format!("socks5://{clash_verge_rev_ip}:{}", port);

    let cliboard = app_handle.clipboard();
    let env_type = { Config::verge().latest().env_type.clone() };
    let env_type = match env_type {
        Some(env_type) => env_type,
        None => {
            #[cfg(not(target_os = "windows"))]
            let default = "bash";
            #[cfg(target_os = "windows")]
            let default = "powershell";

            default.to_string()
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
            log::error!(target: "app", "copy_clash_env: Invalid env type! {env_type}");
            return;
        }
    };

    if cliboard.write_text(export_text).is_err() {
        log::error!(target: "app", "Failed to write to clipboard");
    }
}

extern crate warp;

use super::resolve;
use crate::config::{Config, IVerge, DEFAULT_PAC};
use anyhow::{bail, Result};
use port_scanner::local_port_available;
use tauri::AppHandle;
use warp::Filter;

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();
    if !local_port_available(port) {
        reqwest::get(format!("http://127.0.0.1:{port}/commands/visible"))
            .await?
            .text()
            .await?;
        log::error!("failed to setup singleton listen server");
        bail!("app exists");
    } else {
        Ok(())
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server(app_handle: &AppHandle) {
    let port = IVerge::get_singleton_port();

    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let visible = warp::path!("commands" / "visible").map(move || {
            resolve::create_window(&handle);
            "ok"
        });

        let pac = warp::path!("commands" / "pac").map(move || {
            let content = Config::verge()
                .latest()
                .pac_file_content
                .clone()
                .unwrap_or(DEFAULT_PAC.to_string());
            let port = Config::verge()
                .latest()
                .verge_mixed_port
                .unwrap_or(Config::clash().data().get_mixed_port());
            let content = content.replace("%mixed-port%", &format!("{}", port));
            warp::http::Response::builder()
                .header("Content-Type", "application/x-ns-proxy-autoconfig")
                .body(content)
                .unwrap_or_default()
        });

        let commands = visible.or(pac);
        warp::serve(commands).run(([127, 0, 0, 1], port)).await;
    });
}

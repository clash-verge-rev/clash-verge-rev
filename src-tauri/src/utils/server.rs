extern crate warp;

use super::resolve;
use crate::config::{Config, IVerge, DEFAULT_PAC};
use anyhow::{bail, Result};
use port_scanner::local_port_available;
use std::convert::Infallible;
use tauri::AppHandle;
use warp::http::StatusCode;
use warp::Filter;

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();

    if !local_port_available(port) {
        let resp = reqwest::get(format!("http://127.0.0.1:{port}/commands/ping"))
            .await?
            .text()
            .await?;

        if &resp == "ok" {
            let argvs: Vec<String> = std::env::args().collect();
            if argvs.len() > 1 {
                let param = argvs[1].as_str();
                if param.starts_with("clash:") {
                    reqwest::get(format!(
                        "http://127.0.0.1:{port}/commands/scheme?param={param}"
                    ))
                    .await?
                    .text()
                    .await?;
                }
            } else {
                reqwest::get(format!("http://127.0.0.1:{port}/commands/visible"))
                    .await?
                    .text()
                    .await?;
            }
            bail!("app exists");
        }

        log::error!("failed to setup singleton listen server");
        Ok(())
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
        let ping = warp::path!("commands" / "ping").map(move || "ok");

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
        let scheme = warp::path!("commands" / "scheme")
            .and(warp::query::<QueryParam>())
            .and_then(scheme_handler);

        async fn scheme_handler(query: QueryParam) -> Result<impl warp::Reply, Infallible> {
            let result = resolve::resolve_scheme(query.param).await;
            Ok(match result {
                Ok(_) => warp::reply::with_status("Ok", StatusCode::OK),
                Err(_) => {
                    warp::reply::with_status("Internal Error", StatusCode::INTERNAL_SERVER_ERROR)
                }
            })
        }

        let commands = ping.or(visible).or(pac).or(scheme);
        warp::serve(commands).run(([127, 0, 0, 1], port)).await;
    });
}

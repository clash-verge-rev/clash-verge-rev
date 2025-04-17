extern crate warp;

use super::resolve;
use crate::config::{Config, IVerge, DEFAULT_PAC};
use anyhow::{bail, Result};
use port_scanner::local_port_available;
use std::convert::Infallible;
use warp::Filter;

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

/// check whether there is already exists
pub fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();

    if !local_port_available(port) {
        tauri::async_runtime::block_on(async {
            let resp = reqwest::get(format!("http://127.0.0.1:{port}/commands/ping"))
                .await?
                .text()
                .await?;

            if &resp == "ok" {
                let argvs = std::env::args().collect::<Vec<String>>();
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

            tracing::error!("failed to setup singleton listen server");
            Ok(())
        })
    } else {
        Ok(())
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server() {
    let port = IVerge::get_singleton_port();

    tauri::async_runtime::spawn(async move {
        let ping = warp::path!("commands" / "ping").map(move || "ok");

        let visible = warp::path!("commands" / "visible").map(move || {
            resolve::create_window();
            "ok"
        });

        let pac = warp::path!("commands" / "pac").map(move || {
            let content = Config::verge()
                .latest()
                .pac_file_content
                .clone()
                .unwrap_or(DEFAULT_PAC.to_string());
            let port = Config::clash().latest().get_mixed_port();
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
            resolve::resolve_scheme(query.param).await;
            Ok("ok")
        }
        let commands = ping.or(visible).or(pac).or(scheme);
        warp::serve(commands).run(([127, 0, 0, 1], port)).await;
    });
}

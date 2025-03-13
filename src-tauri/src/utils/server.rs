extern crate warp;

use super::resolve;
use crate::{
    config::{Config, IVerge, DEFAULT_PAC},
    log_err,
};
use anyhow::{bail, Result};
use port_scanner::local_port_available;
use std::convert::Infallible;
use warp::Filter;

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();
    if !local_port_available(port) {
        let argvs: Vec<String> = std::env::args().collect();
        if argvs.len() > 1 {
            #[cfg(not(target_os = "macos"))]
            {
                let param = argvs[1].as_str();
                if param.starts_with("clash:") {
                    let _ = reqwest::get(format!(
                        "http://127.0.0.1:{port}/commands/scheme?param={param}"
                    ))
                    .await;
                }
            }
        } else {
            let _ = reqwest::get(format!("http://127.0.0.1:{port}/commands/visible")).await;
        }
        log::error!("failed to setup singleton listen server");
        bail!("app exists");
    } else {
        Ok(())
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server() {
    let port = IVerge::get_singleton_port();

    tauri::async_runtime::spawn(async move {
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
        async fn scheme_handler(query: QueryParam) -> Result<impl warp::Reply, Infallible> {
            log_err!(resolve::resolve_scheme(query.param).await);
            Ok("ok")
        }

        let scheme = warp::path!("commands" / "scheme")
            .and(warp::query::<QueryParam>())
            .and_then(scheme_handler);
        let commands = visible.or(scheme).or(pac);
        warp::serve(commands).run(([127, 0, 0, 1], port)).await;
    });
}

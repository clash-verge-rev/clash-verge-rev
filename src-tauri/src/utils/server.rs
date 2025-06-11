use super::{help, resolve};
use crate::config::{Config, IVerge, DEFAULT_PAC};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use reqwest::ClientBuilder;
use std::{convert::Infallible, sync::Mutex, time::Duration};
use tokio::sync::oneshot;
use warp::Filter;

// 关闭 embedded server 的信号发送端
static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

/// check whether there is already exists
pub fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();

    if !help::local_port_available(port) {
        tauri::async_runtime::block_on(async {
            let request = ClientBuilder::new()
                .timeout(Duration::from_secs(2))
                .build()?;
            let resp = request
                .get(format!("http://127.0.0.1:{port}/commands/ping"))
                .send()
                .await?
                .text()
                .await?;

            if &resp == "ok" {
                let argvs = std::env::args().collect::<Vec<String>>();
                if argvs.len() > 1 {
                    let param = argvs[1].as_str();
                    if param.starts_with("clash:") {
                        request
                            .get(format!(
                                "http://127.0.0.1:{port}/commands/scheme?param={param}"
                            ))
                            .send()
                            .await?
                            .text()
                            .await?;
                    }
                } else {
                    request
                        .get(format!("http://127.0.0.1:{port}/commands/visible"))
                        .send()
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
pub async fn embed_server() {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let _ = SHUTDOWN_SENDER.set(Mutex::new(Some(shutdown_tx)));
    let port = IVerge::get_singleton_port();
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
    let (_addr, server) =
        warp::serve(commands).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async {
            shutdown_rx.await.ok();
        });
    tokio::task::spawn(server);
}

pub fn shutdown_embedded_server() {
    tracing::info!("Shutting down embedded server");
    if let Some(sender) = SHUTDOWN_SENDER.get() {
        if let Some(sender) = sender.lock().unwrap().take() {
            sender.send(()).ok();
        }
    }
}

use super::resolve;
use crate::{
    config::{Config, DEFAULT_PAC, IVerge},
    logging, logging_error,
    module::lightweight,
    process::AsyncHandler,
    utils::{logging::Type, window_manager::WindowManager},
};
use anyhow::{Result, bail};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use port_scanner::local_port_available;
use std::net::SocketAddr;
use tokio::{net::TcpListener, sync::oneshot};
use warp::Filter;

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

// 关闭 embedded server 的信号发送端
static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();

    if local_port_available(port) {
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(500))
        .build()?;

    let mut attempted = false;
    let mut handled = false;

    #[cfg(not(target_os = "macos"))]
    {
        let argvs: Vec<String> = std::env::args().collect();
        if argvs.len() > 1 {
            let param = argvs[1].as_str();
            if param.starts_with("clash:") {
                attempted = true;
                let url = format!("http://127.0.0.1:{port}/commands/scheme?param={param}");
                handled = send_singleton_command(&client, &url).await;
            }
        }
    }

    if !handled {
        attempted = true;
        let url = format!("http://127.0.0.1:{port}/commands/visible");
        handled = send_singleton_command(&client, &url).await;
    }

    if handled {
        log::error!("failed to setup singleton listen server");
        bail!("app exists");
    }

    if attempted {
        log::warn!(
            "singleton embedded server port {} appears busy but did not respond to singleton handshake; continuing startup",
            port
        );
    }

    Ok(())
}

async fn send_singleton_command(client: &reqwest::Client, url: &str) -> bool {
    match client.get(url).send().await {
        Ok(response) if response.status().is_success() => true,
        Ok(response) => {
            log::warn!(
                "singleton handshake endpoint {} responded with status {}",
                url,
                response.status()
            );
            false
        }
        Err(err) => {
            log::warn!("failed to reach singleton endpoint {}: {}", url, err);
            false
        }
    }
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server() {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    #[allow(clippy::expect_used)]
    SHUTDOWN_SENDER
        .set(Mutex::new(Some(shutdown_tx)))
        .expect("failed to set shutdown signal for embedded server");
    let port = IVerge::get_singleton_port();

    AsyncHandler::spawn(move || async move {
        let visible = warp::path!("commands" / "visible").and_then(|| async {
            logging!(info, Type::Window, "接收到新的启动请求，请求恢复已有窗口");
            AsyncHandler::spawn(|| async {
                logging!(info, Type::Window, "正在处理窗口恢复请求");
                if !lightweight::exit_lightweight_mode().await {
                    let result = WindowManager::show_main_window().await;
                    logging!(info, Type::Window, "窗口恢复操作完成，结果: {:?}", result);
                } else {
                    logging!(info, Type::Window, "应用从轻量模式退出，已触发窗口显示");
                }
            });
            Ok::<_, warp::Rejection>(warp::reply::with_status(
                "ok".to_string(),
                warp::http::StatusCode::OK,
            ))
        });

        let verge_config = Config::verge().await;
        let clash_config = Config::clash().await;

        let content = verge_config
            .latest_ref()
            .pac_file_content
            .clone()
            .unwrap_or(DEFAULT_PAC.to_string());

        let mixed_port = verge_config
            .latest_ref()
            .verge_mixed_port
            .unwrap_or(clash_config.latest_ref().get_mixed_port());

        // Clone the content and port for the closure to avoid borrowing issues
        let pac_content = content.clone();
        let pac_port = mixed_port;
        let pac = warp::path!("commands" / "pac").map(move || {
            let processed_content = pac_content.replace("%mixed-port%", &format!("{pac_port}"));
            warp::http::Response::builder()
                .header("Content-Type", "application/x-ns-proxy-autoconfig")
                .body(processed_content)
                .unwrap_or_default()
        });

        // Use map instead of and_then to avoid Send issues
        let scheme = warp::path!("commands" / "scheme")
            .and(warp::query::<QueryParam>())
            .map(|query: QueryParam| {
                // Spawn async work in a fire-and-forget manner
                let param = query.param.clone();
                tokio::task::spawn_local(async move {
                    logging_error!(Type::Setup, resolve::resolve_scheme(param).await);
                });
                warp::reply::with_status("ok".to_string(), warp::http::StatusCode::OK)
            });

        let commands = visible.or(scheme).or(pac);
        let bind_addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match TcpListener::bind(bind_addr).await {
            Ok(listener) => listener,
            Err(err) => {
                log::warn!(
                    "singleton embedded server failed to bind on 127.0.0.1:{}: {}",
                    port,
                    err
                );
                return;
            }
        };

        warp::serve(commands)
            .incoming(listener)
            .graceful(async move {
                shutdown_rx.await.ok();
            })
            .run()
            .await;
    });
}

pub fn shutdown_embedded_server() {
    log::info!("shutting down embedded server");
    if let Some(sender) = SHUTDOWN_SENDER.get()
        && let Some(sender) = sender.lock().take()
    {
        sender.send(()).ok();
    }
}

use super::resolve;
use crate::{
    cmd::is_port_in_use,
    config::{Config, DEFAULT_PAC, IVerge},
    module::lightweight,
    process::AsyncHandler,
    utils::window_manager::WindowManager,
};
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging, logging_error};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest::ClientBuilder;
use smartstring::alias::String;
use std::time::Duration;
use tokio::sync::oneshot;
use warp::Filter as _;

#[derive(serde::Deserialize, Debug)]
struct QueryParam {
    param: String,
}

// 关闭 embedded server 的信号发送端
static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();
    if is_port_in_use(port) {
        let client = ClientBuilder::new().timeout(Duration::from_millis(500)).build()?;
        // 需要确保 Send
        #[allow(clippy::needless_collect)]
        let argvs: Vec<std::string::String> = std::env::args().collect();
        if argvs.len() > 1 {
            #[cfg(not(target_os = "macos"))]
            {
                let param = argvs[1].as_str();
                if param.starts_with("clash:") {
                    client
                        .get(format!("http://127.0.0.1:{port}/commands/scheme?param={param}"))
                        .send()
                        .await?;
                }
            }
        } else {
            client
                .get(format!("http://127.0.0.1:{port}/commands/visible"))
                .send()
                .await?;
        }
        logging!(error, Type::Window, "failed to setup singleton listen server");
        bail!("app exists");
    }
    Ok(())
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

    let visible = warp::path!("commands" / "visible").and_then(|| async {
        logging!(info, Type::Window, "检测到从单例模式恢复应用窗口");
        if !lightweight::exit_lightweight_mode().await {
            WindowManager::show_main_window().await;
        } else {
            logging!(error, Type::Window, "轻量模式退出失败，无法恢复应用窗口");
        };
        Ok::<_, warp::Rejection>(warp::reply::with_status::<std::string::String>(
            "ok".to_string(),
            warp::http::StatusCode::OK,
        ))
    });

    let pac = warp::path!("commands" / "pac").and_then(|| async move {
        let pac_content = get_currentt_pac_content().await;
        Ok::<_, warp::Rejection>(
            warp::http::Response::builder()
                .header("Content-Type", "application/x-ns-proxy-autoconfig")
                .body(pac_content)
                .unwrap_or_default(),
        )
    });

    // Use map instead of and_then to avoid Send issues
    let scheme = warp::path!("commands" / "scheme")
        .and(warp::query::<QueryParam>())
        .and_then(|query: QueryParam| async move {
            logging_error!(Type::Setup, resolve::resolve_scheme(&query.param).await);
            Ok::<_, warp::Rejection>(warp::reply::with_status::<std::string::String>(
                "ok".to_string(),
                warp::http::StatusCode::OK,
            ))
        });

    let commands = visible.or(scheme).or(pac);

    #[cfg(target_os = "linux")]
    {
        // On Linux, spawing through a new tokio runtime cause to create a new app instance
        // So we have to spawn through AsyncHandler(tauri::async_runtime) to avoid that
        // See relate comments in https://github.com/clash-verge-rev/clash-verge-rev/pull/5908#issuecomment-3678727040
        AsyncHandler::spawn(move || async move {
            run(commands, port, shutdown_rx).await;
        });
    }

    #[cfg(not(target_os = "linux"))]
    if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
        .thread_name("clash-verge-rev-embed-server")
        .worker_threads(1)
        .build()
    {
        rt.spawn(async move {
            run(commands, port, shutdown_rx).await;
        });
    } else {
        // Running in tauri's tokio runtime will cause blocking issues and lots of large task stacks
        // But we should keep this as a fallback plan or we can't start the app in some environments
        AsyncHandler::spawn(move || async move {
            run(commands, port, shutdown_rx).await;
        });
    }
}

async fn run(
    commands: impl warp::Filter<Extract = impl warp::Reply> + Clone + Send + Sync + 'static,
    port: u16,
    shutdown_rx: oneshot::Receiver<()>,
) {
    warp::serve(commands)
        .bind(([127, 0, 0, 1], port))
        .await
        .graceful(async {
            shutdown_rx.await.ok();
        })
        .run()
        .await;
}

pub fn shutdown_embedded_server() {
    logging!(info, Type::Window, "shutting down embedded server");
    if let Some(sender) = SHUTDOWN_SENDER.get()
        && let Some(sender) = sender.lock().take()
    {
        sender.send(()).ok();
    }
}

async fn get_currentt_pac_content() -> std::string::String {
    let pac_content = {
        Config::verge()
            .await
            .data_arc()
            .pac_file_content
            .clone()
            .unwrap_or_else(|| DEFAULT_PAC.into())
    };
    let clash_mixed_port = { Config::clash().await.data_arc().get_mixed_port() };
    let pac_port = {
        Config::verge()
            .await
            .data_arc()
            .verge_mixed_port
            .unwrap_or(clash_mixed_port)
    };
    pac_content.replace("%mixed-port%", &format!("{pac_port}"))
}

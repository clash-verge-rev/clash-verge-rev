use super::resolve;
use crate::{
    config::{Config, DEFAULT_PAC, IVerge},
    logging_error,
    process::AsyncHandler,
    utils::logging::Type,
};
use anyhow::{Result, bail};
use port_scanner::local_port_available;
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
    }
    Ok(())
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server() {
    let port = IVerge::get_singleton_port();

    AsyncHandler::spawn(move || async move {
        let visible = warp::path!("commands" / "visible").and_then(|| async {
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
                    logging_error!(Type::Setup, true, resolve::resolve_scheme(param).await);
                });
                warp::reply::with_status("ok".to_string(), warp::http::StatusCode::OK)
            });

        let commands = visible.or(scheme).or(pac);
        warp::serve(commands).run(([127, 0, 0, 1], port)).await;
    });
}

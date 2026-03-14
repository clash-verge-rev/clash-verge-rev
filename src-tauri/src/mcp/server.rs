use crate::config::Config;
use crate::process::AsyncHandler;
use clash_verge_logging::{Type, logging};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::sync::oneshot;
use warp::Filter as _;
use warp::http::HeaderMap;

use super::protocol::{JsonRpcRequest, JsonRpcResponse, PARSE_ERROR};

static MCP_SHUTDOWN: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

pub fn start_mcp_server() {
    AsyncHandler::spawn(|| async {
        let verge = Config::verge().await;
        let data = verge.data_arc();

        let enabled = data.enable_mcp_server.unwrap_or(false);
        if !enabled {
            logging!(info, Type::Setup, "MCP server is disabled");
            return;
        }

        let port = data
            .mcp_server_port
            .unwrap_or(crate::constants::network::ports::DEFAULT_MCP_SERVER);
        let secret: Option<std::string::String> = data.mcp_server_secret.clone().map(|s| s.to_string());

        drop(data);
        drop(verge);

        logging!(info, Type::Setup, "Starting MCP server on port {port}");
        launch_server(port, secret);
    });
}

fn extract_bearer(headers: &HeaderMap) -> Option<std::string::String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn check_auth(expected: &Option<std::string::String>, headers: &HeaderMap) -> Result<(), warp::Rejection> {
    if let Some(ref secret) = *expected {
        let token = extract_bearer(headers);
        if token.as_deref() != Some(secret.as_str()) {
            return Err(warp::reject::custom(Unauthorized));
        }
    }
    Ok(())
}

fn launch_server(port: u16, secret: Option<std::string::String>) {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let _ = MCP_SHUTDOWN.set(Mutex::new(Some(shutdown_tx)));

    let secret = Arc::new(secret);

    let s1 = Arc::clone(&secret);
    let mcp_post = warp::path!("mcp")
        .and(warp::post())
        .and(warp::header::headers_cloned())
        .and(warp::body::json::<serde_json::Value>())
        .and_then(move |headers: HeaderMap, body: serde_json::Value| {
            let secret = Arc::clone(&s1);
            async move {
                check_auth(&secret, &headers)?;
                handle_mcp_post(body).await
            }
        });

    let s2 = Arc::clone(&secret);
    let mcp_get = warp::path!("mcp")
        .and(warp::get())
        .and(warp::header::headers_cloned())
        .and_then(move |headers: HeaderMap| {
            let secret = Arc::clone(&s2);
            async move {
                check_auth(&secret, &headers)?;
                handle_mcp_get()
            }
        });

    let s3 = Arc::clone(&secret);
    let mcp_delete = warp::path!("mcp")
        .and(warp::delete())
        .and(warp::header::headers_cloned())
        .and_then(move |headers: HeaderMap| {
            let secret = Arc::clone(&s3);
            async move {
                check_auth(&secret, &headers)?;
                handle_mcp_delete()
            }
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec![
            warp::http::Method::GET,
            warp::http::Method::POST,
            warp::http::Method::DELETE,
            warp::http::Method::OPTIONS,
        ])
        .allow_headers(vec![
            warp::http::header::CONTENT_TYPE,
            warp::http::header::AUTHORIZATION,
            warp::http::header::ACCEPT,
        ]);

    let routes = mcp_post.or(mcp_get).or(mcp_delete).recover(handle_rejection).with(cors);

    logging!(info, Type::Setup, "MCP server listening on 127.0.0.1:{port}");

    AsyncHandler::spawn(move || async move {
        warp::serve(routes)
            .bind(([127, 0, 0, 1], port))
            .await
            .graceful(async {
                shutdown_rx.await.ok();
            })
            .run()
            .await;
    });
}

pub fn shutdown_mcp_server() {
    if let Some(sender) = MCP_SHUTDOWN.get()
        && let Some(sender) = sender.lock().take()
    {
        logging!(info, Type::Setup, "Shutting down MCP server");
        sender.send(()).ok();
    }
}

async fn handle_mcp_post(body: serde_json::Value) -> Result<Box<dyn warp::Reply>, warp::Rejection> {
    let req: JsonRpcRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            let resp = JsonRpcResponse::error(None, PARSE_ERROR, e.to_string());
            return Ok(Box::new(warp::reply::json(&resp)));
        }
    };

    match super::handle_jsonrpc(req).await {
        Some(resp) => Ok(Box::new(warp::reply::json(&resp))),
        None => Ok(Box::new(warp::reply::with_status(
            warp::reply::json(&serde_json::json!({})),
            warp::http::StatusCode::ACCEPTED,
        ))),
    }
}

#[allow(clippy::unnecessary_wraps)]
fn handle_mcp_get() -> Result<Box<dyn warp::Reply>, warp::Rejection> {
    Ok(Box::new(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({
            "status": "MCP server is running",
            "protocol": "2025-03-26",
            "transport": "streamable-http"
        })),
        warp::http::StatusCode::OK,
    )))
}

#[allow(clippy::unnecessary_wraps)]
fn handle_mcp_delete() -> Result<Box<dyn warp::Reply>, warp::Rejection> {
    Ok(Box::new(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({})),
        warp::http::StatusCode::OK,
    )))
}

#[derive(Debug)]
struct Unauthorized;
impl warp::reject::Reject for Unauthorized {}

async fn handle_rejection(err: warp::Rejection) -> Result<impl warp::Reply, std::convert::Infallible> {
    let (code, message) = if err.find::<Unauthorized>().is_some() {
        (warp::http::StatusCode::UNAUTHORIZED, "Unauthorized")
    } else if err.find::<warp::reject::MethodNotAllowed>().is_some() {
        (warp::http::StatusCode::METHOD_NOT_ALLOWED, "Method not allowed")
    } else {
        (warp::http::StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
    };

    Ok(warp::reply::with_status(
        warp::reply::json(&serde_json::json!({ "error": message })),
        code,
    ))
}

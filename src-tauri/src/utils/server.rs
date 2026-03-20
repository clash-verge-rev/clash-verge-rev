use super::resolve;
use crate::{
    cmd::is_port_in_use,
    config::{Config, DEFAULT_PAC, IVerge},
    module::lightweight,
    process::AsyncHandler,
    utils::{dirs::APP_ID, window_manager::WindowManager},
};
use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use clash_verge_logging::{Type, logging, logging_error};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use reqwest::ClientBuilder;
use smartstring::alias::String;
use std::{env::temp_dir, fs, path::PathBuf, time::Duration};
use tokio::sync::oneshot;
use warp::Filter as _;

const SINGLETON_TOKEN_FILE: &str = "singleton-auth-token";
const SINGLETON_TOKEN_HEADER: &str = "x-clash-verge-singleton-token";

#[derive(serde::Deserialize, serde::Serialize, Debug)]
struct QueryParam {
    param: String,
}

// 关闭 embedded server 的信号发送端
static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

fn singleton_token_path() -> PathBuf {
    temp_dir().join(APP_ID).join(SINGLETON_TOKEN_FILE)
}

fn write_singleton_token() -> Result<String> {
    let mut token_bytes = [0_u8; 32];
    getrandom::fill(&mut token_bytes)?;
    let token = URL_SAFE_NO_PAD.encode(token_bytes);
    let token_path = singleton_token_path();

    if let Some(parent) = token_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&token_path, &token)?;
    Ok(token.into())
}

fn read_singleton_token() -> Result<String> {
    let token = fs::read_to_string(singleton_token_path())?;
    let token = token.trim().to_string();
    if token.is_empty() {
        bail!("singleton auth token is empty");
    }
    Ok(token.into())
}

fn cleanup_singleton_token() {
    let _ = fs::remove_file(singleton_token_path());
}

fn singleton_ok() -> warp::reply::WithStatus<std::string::String> {
    warp::reply::with_status("ok".to_string(), warp::http::StatusCode::OK)
}

fn singleton_unauthorized() -> warp::reply::WithStatus<std::string::String> {
    warp::reply::with_status(
        "unauthorized".to_string(),
        warp::http::StatusCode::UNAUTHORIZED,
    )
}

async fn notify_existing_instance_visible(
    client: &reqwest::Client,
    port: u16,
    token: Option<&str>,
) -> Result<()> {
    if let Some(token) = token {
        match client
            .post(format!("http://127.0.0.1:{port}/commands/visible"))
            .header(SINGLETON_TOKEN_HEADER, token)
            .send()
            .await?
            .error_for_status()
        {
            Ok(_) => return Ok(()),
            Err(err) => {
                logging!(
                    warn,
                    Type::Window,
                    "singleton auth visible request failed, fallback to legacy GET: {err}"
                );
            }
        }
    }

    client
        .get(format!("http://127.0.0.1:{port}/commands/visible"))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn notify_existing_instance_scheme(
    client: &reqwest::Client,
    port: u16,
    param: &str,
    token: Option<&str>,
) -> Result<()> {
    let query = QueryParam {
        param: param.to_string().into(),
    };

    if let Some(token) = token {
        match client
            .post(format!("http://127.0.0.1:{port}/commands/scheme"))
            .header(SINGLETON_TOKEN_HEADER, token)
            .form(&query)
            .send()
            .await?
            .error_for_status()
        {
            Ok(_) => return Ok(()),
            Err(err) => {
                logging!(
                    warn,
                    Type::Window,
                    "singleton auth scheme request failed, fallback to legacy GET: {err}"
                );
            }
        }
    }

    client
        .get(format!("http://127.0.0.1:{port}/commands/scheme"))
        .query(&query)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// check whether there is already exists
pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();
    if is_port_in_use(port) {
        let token = match read_singleton_token() {
            Ok(token) => Some(token),
            Err(err) => {
                logging!(
                    warn,
                    Type::Window,
                    "singleton auth token unavailable, fallback to legacy notify: {err}"
                );
                None
            }
        };
        let client = ClientBuilder::new().timeout(Duration::from_millis(500)).build()?;
        // 需要确保 Send
        #[allow(clippy::needless_collect)]
        let argvs: Vec<std::string::String> = std::env::args().collect();
        if argvs.len() > 1 {
            #[cfg(not(target_os = "macos"))]
            {
                let param = argvs[1].as_str();
                if param.starts_with("clash:") {
                    if let Err(err) =
                        notify_existing_instance_scheme(&client, port, param, token.as_deref()).await
                    {
                        logging!(
                            warn,
                            Type::Window,
                            "failed to notify existing instance scheme handler: {err}"
                        );
                    }
                }
            }
        } else {
            if let Err(err) = notify_existing_instance_visible(&client, port, token.as_deref()).await
            {
                logging!(
                    warn,
                    Type::Window,
                    "failed to notify existing instance visible handler: {err}"
                );
            }
        }
        logging!(error, Type::Window, "failed to setup singleton listen server");
        bail!("app exists");
    }
    Ok(())
}

/// The embed server only be used to implement singleton process
/// maybe it can be used as pac server later
pub fn embed_server() {
    let auth_token = match write_singleton_token() {
        Ok(token) => token,
        Err(err) => {
            logging!(error, Type::Window, "failed to create singleton auth token: {err}");
            return;
        }
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    #[allow(clippy::expect_used)]
    SHUTDOWN_SENDER
        .set(Mutex::new(Some(shutdown_tx)))
        .expect("failed to set shutdown signal for embedded server");
    let port = IVerge::get_singleton_port();

    let visible_auth_token = auth_token.clone();
    let visible = warp::path!("commands" / "visible")
        .and(warp::post())
        .and(warp::header::optional::<std::string::String>(
            SINGLETON_TOKEN_HEADER,
        ))
        .and_then(move |token: Option<std::string::String>| {
            let expected = visible_auth_token.clone();
            async move {
                if token.as_deref() != Some(expected.as_str()) {
                    return Ok::<_, warp::Rejection>(singleton_unauthorized());
                }

                logging!(info, Type::Window, "检测到从单例模式恢复应用窗口");
                if !lightweight::exit_lightweight_mode().await {
                    WindowManager::show_main_window().await;
                } else {
                    logging!(error, Type::Window, "轻量模式退出失败，无法恢复应用窗口");
                };
                Ok::<_, warp::Rejection>(singleton_ok())
            }
        });

    let pac = warp::path!("commands" / "pac")
        .and(warp::get())
        .and_then(|| async move {
            let verge_config = Config::verge().await;
            let clash_config = Config::clash().await;

            let pac_content = verge_config
                .data_arc()
                .pac_file_content
                .clone()
                .unwrap_or_else(|| DEFAULT_PAC.into());

            let pac_port = verge_config
                .data_arc()
                .verge_mixed_port
                .unwrap_or_else(|| clash_config.data_arc().get_mixed_port());
            let processed_content = pac_content.replace("%mixed-port%", &format!("{pac_port}"));
            Ok::<_, warp::Rejection>(
                warp::http::Response::builder()
                    .header("Content-Type", "application/x-ns-proxy-autoconfig")
                    .body(processed_content)
                    .unwrap_or_default(),
            )
        });

    // Use map instead of and_then to avoid Send issues
    let scheme_auth_token = auth_token.clone();
    let scheme = warp::path!("commands" / "scheme")
        .and(warp::post())
        .and(warp::header::optional::<std::string::String>(
            SINGLETON_TOKEN_HEADER,
        ))
        .and(warp::body::form::<QueryParam>())
        .and_then(move |token: Option<std::string::String>, query: QueryParam| {
            let expected = scheme_auth_token.clone();
            async move {
                if token.as_deref() != Some(expected.as_str()) {
                    return Ok::<_, warp::Rejection>(singleton_unauthorized());
                }

                AsyncHandler::spawn(|| async move {
                    logging_error!(Type::Setup, resolve::resolve_scheme(&query.param).await);
                });
                Ok::<_, warp::Rejection>(singleton_ok())
            }
        });

    let commands = visible.or(scheme).or(pac);

    AsyncHandler::spawn(move || async move {
        warp::serve(commands)
            .bind(([127, 0, 0, 1], port))
            .await
            .graceful(async {
                shutdown_rx.await.ok();
            })
            .run()
            .await;
    });
}

pub fn shutdown_embedded_server() {
    logging!(info, Type::Window, "shutting down embedded server");
    cleanup_singleton_token();
    if let Some(sender) = SHUTDOWN_SENDER.get()
        && let Some(sender) = sender.lock().take()
    {
        sender.send(()).ok();
    }
}

use std::time::Duration;

use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use ntex::web;
use port_scanner::local_port_available;
use reqwest::ClientBuilder;
use serde::{Deserialize, Serialize};

use crate::{
    config::{Config, DEFAULT_PAC, IVerge},
    module::lightweight,
    utils::{resolve, window_manager::WindowManager},
};

#[derive(Deserialize, Serialize)]
struct QueryParam {
    param: String,
}

#[web::get("hello")]
async fn current_hello() -> impl web::Responder {
    web::HttpResponse::Ok().body("hello")
}

#[web::get("commands/visible")]
async fn current_visible() -> impl web::Responder {
    if !lightweight::exit_lightweight_mode().await {
        WindowManager::show_main_window().await;
    }
    web::HttpResponse::Ok().body("ok")
}

#[web::get("commands/pac")]
async fn current_pac_content() -> impl web::Responder {
    let verge = Config::verge().await;
    let clash = Config::clash().await;

    let pac_content = verge
        .data_arc()
        .pac_file_content
        .clone()
        .unwrap_or_else(|| DEFAULT_PAC.into());
    let pac_port = verge
        .data_arc()
        .verge_mixed_port
        .unwrap_or_else(|| clash.data_arc().get_mixed_port());

    let processed_content = pac_content.replace("%mixed-port%", &format!("{pac_port}"));

    web::HttpResponse::Ok()
        .content_type("application/x-ns-proxy-autoconfig")
        .body(processed_content)
}

#[web::get("commands/scheme")]
async fn current_scheme(param: web::types::Query<QueryParam>) -> impl web::Responder {
    match resolve::resolve_scheme(&param.param).await {
        Ok(_) => web::HttpResponse::Ok().body("ok"),
        Err(e) => {
            logging!(error, Type::Setup, "failed to resolve scheme: {}", e);
            web::HttpResponse::InternalServerError().body("failed to resolve scheme")
        }
    }
}

pub async fn check_singleton() -> Result<()> {
    let port = IVerge::get_singleton_port();
    if !local_port_available(port) {
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

pub async fn embed_server() -> std::io::Result<()> {
    let port = IVerge::get_singleton_port();
    web::HttpServer::new(|| {
        web::App::new().service((current_hello, current_visible, current_pac_content, current_scheme))
    })
    .workers(1)
    .bind(("127.0.0.1", port))?
    .run()
    .await
}

use crate::{
    config::{Config, DEFAULT_PAC, IVerge},
    logging,
    process::AsyncHandler,
    utils::logging::Type,
};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use tokio::sync::oneshot;
use warp::Filter;

// 关闭 embedded server 的信号发送端
static SHUTDOWN_SENDER: OnceCell<Mutex<Option<oneshot::Sender<()>>>> = OnceCell::new();

/// The embed server only be used as pac server
pub fn embed_server() {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    #[allow(clippy::expect_used)]
    SHUTDOWN_SENDER
        .set(Mutex::new(Some(shutdown_tx)))
        .expect("failed to set shutdown signal for embedded server");
    let port = IVerge::get_singleton_port();

    AsyncHandler::spawn(move || async move {
        let verge_config = Config::verge().await;
        let clash_config = Config::clash().await;

        let pac_content = verge_config
            .latest_arc()
            .pac_file_content
            .clone()
            .unwrap_or_else(|| DEFAULT_PAC.into());

        let pac_port = verge_config
            .latest_arc()
            .verge_mixed_port
            .unwrap_or_else(|| clash_config.latest_arc().get_mixed_port());

        let pac = warp::path!("commands" / "pac").map(move || {
            let processed_content = pac_content.replace("%mixed-port%", &format!("{pac_port}"));
            warp::http::Response::builder()
                .header("Content-Type", "application/x-ns-proxy-autoconfig")
                .body(processed_content)
                .unwrap_or_default()
        });

        warp::serve(pac)
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
    if let Some(sender) = SHUTDOWN_SENDER.get()
        && let Some(sender) = sender.lock().take()
    {
        sender.send(()).ok();
    }
}

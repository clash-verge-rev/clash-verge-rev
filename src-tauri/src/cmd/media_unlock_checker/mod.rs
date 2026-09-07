pub use clash_verge_media_unlock::UnlockItem;
use reqwest::{Client, Proxy};
use std::time::Duration;
use tauri::{command, ipc::Channel};

#[command]
pub fn get_unlock_items() -> Vec<UnlockItem> {
    clash_verge_media_unlock::default_unlock_items()
}

async fn create_client() -> Result<Client, String> {
    let port = crate::config::MixedPort::effective().await;
    let proxy = Proxy::all(format!("http://127.0.0.1:{port}")).map_err(|error| format!("创建代理失败: {error}"))?;

    Client::builder()
        .use_rustls_tls()
        .http1_only()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .tcp_keepalive(Duration::from_secs(60))
        .cookie_store(true)
        .proxy(proxy)
        .build()
        .map_err(|error| format!("创建HTTP客户端失败: {error}"))
}

#[command]
pub async fn check_media_unlock(on_complete: Channel<UnlockItem>) -> Result<Vec<UnlockItem>, String> {
    let client = create_client().await?;
    Ok(clash_verge_media_unlock::check_media_unlock(&client, |item| {
        let _ = on_complete.send(item.clone());
    })
    .await)
}

#[command]
pub async fn check_media_unlock_item(name: String) -> Result<UnlockItem, String> {
    let client = create_client().await?;
    clash_verge_media_unlock::check_media_unlock_item(&client, &name).await
}

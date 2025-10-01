use tauri_plugin_mihomo::{Result, ret_failed_resp};

mod common;

#[tokio::test]
async fn mihomo_connection_list() -> Result<()> {
    let mihomo = common::mihomo();
    let connections = mihomo.get_connections().await?;
    println!("{connections:?}");
    Ok(())
}

#[tokio::test]
async fn mihomo_connection_close() -> Result<()> {
    let mihomo = common::mihomo();
    let mut max_count = 20;
    let connections = loop {
        if max_count == 0 {
            ret_failed_resp!("no connections");
        }
        let conns = mihomo.get_connections().await?;
        if conns.connections.is_some() {
            break conns;
        }
        max_count -= 1;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    };
    if let Some(connections) = connections.connections
        && let Some(first) = connections.first()
    {
        mihomo.close_connection(&first.id).await?;
    }
    Ok(())
}

#[tokio::test]
async fn mihomo_connection_close_all() -> Result<()> {
    let mihomo = common::mihomo();
    mihomo.close_all_connections().await?;
    Ok(())
}

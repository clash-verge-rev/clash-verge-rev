use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
async fn connections_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;

    let connections = mihomo.get_connections().await?;
    println!("connectons: {:#?}", connections);

    let first_conn_id = &connections.connections.get(0).unwrap().id;
    println!("first connecton id: {}", first_conn_id);
    mihomo.close_connection(first_conn_id).await?;

    mihomo.close_all_connections().await?;

    Ok(())
}

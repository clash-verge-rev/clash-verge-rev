use anyhow::Result;

mod utils;

#[tokio::test]
async fn connections_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;

    let connections = mihomo.get_connections().await?;
    println!("connectons: {:#?}", connections);

    let first_conn_id = &connections.connections.get(0).unwrap().id;
    println!("first connecton id: {}", first_conn_id);
    mihomo.close_connection(first_conn_id).await?;

    mihomo.close_all_connections().await?;

    Ok(())
}

use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
async fn proxies_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;
    let proxies = mihomo.get_proxies().await?;
    println!("proxies: {:#?}", proxies);

    let proxy = mihomo.get_proxy_by_name("AIGC").await?;
    println!("proxy {:#?}", proxy);

    // let proxy = mihomo.get_proxy_by_name("AIGC").await?;
    // println!("proxy now: {:#?}", proxy.now);
    mihomo.select_node_for_proxy("AIGC", "US AUTO").await?;
    let proxy = mihomo.get_proxy_by_name("AIGC").await?;
    println!("proxy now: {:#?}", proxy.now);

    let delay = mihomo
        .delay_proxy_by_name("HK AUTO", "https://www.gstatic.com/generate_204", 5000)
        .await?;
    println!("proxy delay: {:#?}", delay);

    Ok(())
}

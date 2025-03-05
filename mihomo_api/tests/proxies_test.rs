use anyhow::Result;

mod utils;

#[tokio::test]
async fn proxies_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;
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

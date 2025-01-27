use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
pub async fn group_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;

    let group = mihomo.get_groups().await?;
    println!("group result: {:?}", group);

    let first_proxy = group.proxies.get(0);
    let first_proxy_name = first_proxy.unwrap().name.clone();
    let get_group = mihomo.get_group_by_name(&first_proxy_name).await?;
    println!("get first group: {:?}", get_group);

    let group_delay = mihomo
        .delay_group(
            &first_proxy_name,
            "https://www.gstatic.com/generate_204",
            5000,
        )
        .await?;
    println!("group delay: {:#?}", group_delay);
    Ok(())
}

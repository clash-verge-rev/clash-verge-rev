use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
async fn providers_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;
    let providers = mihomo.get_proxies_providers().await?;
    println!("providers: {:#?}", providers.providers.get("AIGC"));

    let proxy = mihomo.get_providers_proxy_by_name("AIGC").await?;
    println!("providers proxy: {:#?}", proxy);

    mihomo.healthcheck_providers("AIGC").await?;

    mihomo
        .healthcheck_providers_proxies(
            "AIGC",
            "SG AUTO",
            "https://www.gstatic.com/generate_204",
            5000,
        )
        .await?;

    Ok(())
}

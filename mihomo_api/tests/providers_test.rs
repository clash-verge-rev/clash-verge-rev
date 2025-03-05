use anyhow::Result;

mod utils;

#[tokio::test]
async fn providers_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;
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

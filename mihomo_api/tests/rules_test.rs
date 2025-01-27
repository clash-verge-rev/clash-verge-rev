use anyhow::Result;
use mihomo_api::{model::Protocol, MihomoBuilder};

#[tokio::test]
async fn rules_test() -> Result<()> {
    let mihomo = MihomoBuilder::new()
        .set_protocol(Protocol::Http)
        .set_external_host("127.0.0.1")
        .set_external_port(9090)
        .set_secret("nBaciu2IqTZoGd6NBajit")
        .build()?;

    // let rules = mihomo.get_rules().await?;
    // println!("rules: {:#?}", rules);

    // let rules_providers = mihomo.get_rules_providers().await?;
    // println!("rule providers: {:#?}", rules_providers);

    mihomo.update_rules_providers("youtube_domain").await?;
    let rules_providers = mihomo.get_rules_providers().await?;
    println!(
        "rule providers: {:#?}",
        rules_providers.providers.get("youtube_domain")
    );

    Ok(())
}

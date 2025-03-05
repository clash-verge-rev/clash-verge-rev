use anyhow::Result;

mod utils;

#[tokio::test]
async fn rules_test() -> Result<()> {
    let mihomo = utils::default_mihomo()?;

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

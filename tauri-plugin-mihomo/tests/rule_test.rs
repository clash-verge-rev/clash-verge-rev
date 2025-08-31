use tauri_plugin_mihomo::{Error, Result};

mod common;

#[tokio::test]
async fn mihomo_rule_list() -> Result<()> {
    let mihomo = common::mihomo();
    let rules = mihomo.get_rules().await?;
    println!("{:?}", rules.rules);
    Ok(())
}

#[tokio::test]
async fn mihomo_rule_providers() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_rule_providers().await?;
    println!("{:?}", providers.providers);
    Ok(())
}

#[tokio::test]
async fn mihomo_rule_update_provider() -> Result<()> {
    let mihomo = common::mihomo();
    let providers = mihomo.get_rule_providers().await?;
    let provider_name = providers
        .providers
        .keys()
        .next()
        .ok_or(Error::FailedResponse("no rule provider".to_string()))?;
    println!("update rule provider: {}", provider_name);
    mihomo.update_rule_provider(provider_name).await?;
    Ok(())
}

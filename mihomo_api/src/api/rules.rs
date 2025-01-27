use crate::{
    model::{RuleProviders, Rules},
    Mihomo,
};
use anyhow::{bail, Result};
use reqwest::Method;

impl Mihomo {
    pub async fn get_rules(&self) -> Result<Rules> {
        let client = self.build_requet(Method::GET, "/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get rules failed");
        }
        Ok(response.json::<Rules>().await?)
    }

    pub async fn get_rules_providers(&self) -> Result<RuleProviders> {
        let client = self.build_requet(Method::GET, "/providers/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get rules providers failed");
        }
        Ok(response.json::<RuleProviders>().await?)
    }

    pub async fn update_rules_providers(&self, providers_name: &str) -> Result<()> {
        let client =
            self.build_requet(Method::PUT, &format!("/providers/rules/{}", providers_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("update rules providers failed");
        }
        Ok(())
    }
}

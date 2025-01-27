use crate::{
    model::{Providers, ProxyProviders},
    Mihomo,
};
use anyhow::{bail, Result};
use reqwest::Method;

impl Mihomo {
    pub async fn get_proxies_providers(&self) -> Result<Providers> {
        let client = self.build_requet(Method::GET, "/providers/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get providers proxy failed");
        }
        Ok(response.json::<Providers>().await?)
    }

    pub async fn get_providers_proxy_by_name(
        &self,
        providers_name: &str,
    ) -> Result<ProxyProviders> {
        let client = self.build_requet(
            Method::GET,
            &format!("/providers/proxies/{}", providers_name),
        )?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get providers proxy failed");
        }
        Ok(response.json::<ProxyProviders>().await?)
    }

    pub async fn healthcheck_providers(&self, providers_name: &str) -> Result<()> {
        let suffix_url = format!("/providers/proxies/{}/healthcheck", providers_name);
        let client = self.build_requet(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("healthcheck providers failed");
        }
        Ok(())
    }

    pub async fn healthcheck_providers_proxies(
        &self,
        providers_name: &str,
        proxies_name: &str,
        test_url: &str,
        timeout: u32,
    ) -> Result<()> {
        let suffix_url = format!(
            "/providers/proxies/{}/{}/healthcheck?url={}&timeout={}",
            providers_name, proxies_name, test_url, timeout
        );
        let client = self.build_requet(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("healthcheck providers failed");
        }
        Ok(())
    }
}

use crate::{
    model::{Proxies, Proxy, ProxyDelay},
    Mihomo,
};
use anyhow::{bail, Result};
use reqwest::Method;
use serde_json::json;

impl Mihomo {
    pub async fn get_proxies(&self) -> Result<Proxies> {
        let client = self.build_requet(Method::GET, "/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get proxies failed");
        }
        Ok(response.json::<Proxies>().await?)
    }

    pub async fn get_proxy_by_name(&self, proxy_name: &str) -> Result<Proxy> {
        let client = self.build_requet(Method::GET, &format!("/proxies/{}", proxy_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get proxy by name failed");
        }
        Ok(response.json::<Proxy>().await?)
    }

    pub async fn select_node_for_proxy(&self, proxy_name: &str, node: &str) -> Result<()> {
        let client = self.build_requet(Method::PUT, &format!("/proxies/{}", proxy_name))?;
        let body = json!({
            "name": node
        });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            bail!("select node for proxy failed");
        }
        Ok(())
    }

    pub async fn delay_proxy_by_name(
        &self,
        proxy_name: &str,
        test_url: &str,
        timeout: u32,
    ) -> Result<ProxyDelay> {
        let suffix_url = format!("/proxies/{}/delay", proxy_name);
        let client = self.build_requet(Method::GET, &suffix_url)?;
        let response = client
            .query(&[
                ("timeout", &format!("{timeout}")),
                ("url", &format!("{test_url}")),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            match response.json::<ProxyDelay>().await {
                Ok(delay) => {
                    return Ok(delay);
                }
                Err(_) => {
                    bail!("get proxy by name failed");
                }
            }
        }
        Ok(response.json::<ProxyDelay>().await?)
    }
}

use crate::model::{GroupProxies, Proxy};
use crate::Mihomo;
use anyhow::{bail, Result};
use reqwest::Method;
use std::collections::HashMap;

impl Mihomo {
    pub async fn get_groups(&self) -> Result<GroupProxies> {
        let client = self.build_requet(Method::GET, "/group")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get group error");
        }
        Ok(response.json::<GroupProxies>().await?)
    }

    pub async fn get_group_by_name(&self, group_name: &str) -> Result<Proxy> {
        let client = self.build_requet(Method::GET, &format!("/group/{}", group_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get group error");
        }
        Ok(response.json::<Proxy>().await?)
    }

    pub async fn delay_group(
        &self,
        group_name: &str,
        test_url: &str,
        timeout: u32,
    ) -> Result<HashMap<String, u32>> {
        let suffix_url = format!(
            "/group/{}/delay?url={}&timeout={}",
            group_name, test_url, timeout
        );
        let client = self.build_requet(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get group error");
        }
        Ok(response.json::<HashMap<String, u32>>().await?)
    }
}

use crate::{model::Connections, Mihomo};
use anyhow::{bail, Result};
use reqwest::Method;

impl Mihomo {
    pub async fn get_connections(&self) -> Result<Connections> {
        let client = self.build_requet(Method::GET, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get connections failed");
        }
        Ok(response.json::<Connections>().await?)
    }

    pub async fn close_all_connections(&self) -> Result<()> {
        let client = self.build_requet(Method::DELETE, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("close all connections failed");
        }
        Ok(())
    }

    pub async fn close_connection(&self, connection_id: &str) -> Result<()> {
        let client =
            self.build_requet(Method::DELETE, &format!("/connections/{}", connection_id))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("close all connections failed");
        }
        Ok(())
    }
}

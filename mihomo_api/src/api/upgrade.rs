use crate::Mihomo;
use anyhow::{bail, Result};
use reqwest::Method;
use std::collections::HashMap;

impl Mihomo {
    pub async fn upgrade_core(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/upgrade")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            let res = response.json::<HashMap<String, String>>().await?;
            match res.get("message") {
                Some(msg) => {
                    if msg.contains("already using latest version") {
                        return Ok(());
                    }
                    bail!(msg.clone());
                }
                None => {
                    bail!("upgrade core failed");
                }
            }
        }
        Ok(())
    }

    pub async fn upgrade_ui(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/upgrade/ui")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("upgrade ui failed");
        }
        Ok(())
    }

    pub async fn upgrade_geo(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/upgrade/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("upgrade geo failed");
        }
        Ok(())
    }
}

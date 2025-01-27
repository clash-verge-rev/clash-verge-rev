use crate::model::BaseConfig;
use crate::Mihomo;
use anyhow::{bail, Result};
use reqwest::Method;
use serde::Serialize;
use serde_json::json;

impl Mihomo {
    pub async fn get_base_config(&self) -> Result<BaseConfig> {
        let client = self.build_requet(Method::GET, "/configs")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("get base config error");
        }
        Ok(response.json::<BaseConfig>().await?)
    }

    pub async fn reload_config(&self, force: bool, path: &str) -> Result<()> {
        let suffix_url = if force {
            "/configs".to_string()
        } else {
            format!("{}?force=true", "/configs")
        };
        let client = self.build_requet(Method::PUT, &suffix_url)?;
        let body = json!({ "path": path });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            bail!("reload base config error");
        }
        Ok(())
    }

    pub async fn patch_base_config<D: Serialize + ?Sized>(&self, data: &D) -> Result<()> {
        let client = self.build_requet(Method::PATCH, "/configs")?;
        let response = client.json(&data).send().await?;
        if !response.status().is_success() {
            bail!("patch base config error, {:?}", response);
        }
        Ok(())
    }

    pub async fn update_geo(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/configs/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("update geo datebase error");
        }
        Ok(())
    }

    pub async fn restart(&self) -> Result<()> {
        let client = self.build_requet(Method::POST, "/restart")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            bail!("restart core error");
        }
        Ok(())
    }
}

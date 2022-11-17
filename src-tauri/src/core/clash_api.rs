use crate::{config::Config, utils::dirs};
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde_yaml::Mapping;
use std::collections::HashMap;

/// PUT /configs
pub async fn put_configs() -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs");

    let runtime_yaml = dirs::clash_runtime_yaml();
    let runtime_yaml = dirs::path_to_str(&runtime_yaml)?;

    let mut data = HashMap::new();
    data.insert("path", runtime_yaml);

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let builder = client.put(&url).headers(headers).json(&data);
    let response = builder.send().await?;

    match response.status().as_u16() {
        204 => Ok(()),
        status @ _ => {
            bail!("failed to put configs with status \"{status}\"")
        }
    }
}

/// PATCH /configs
pub async fn patch_configs(config: &Mapping) -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs");

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let builder = client.patch(&url).headers(headers.clone()).json(config);
    builder.send().await?;
    Ok(())
}

/// 根据clash info获取clash服务地址和请求头
fn clash_client_info() -> Result<(String, HeaderMap)> {
    let info = { Config::clash().data().get_info()? };

    if info.server.is_none() {
        let status = &info.status;
        if info.port.is_none() {
            bail!("failed to parse config.yaml file with status {status}");
        } else {
            bail!("failed to parse the server with status {status}");
        }
    }

    let server = info.server.unwrap();
    let server = format!("http://{server}");

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse()?);

    if let Some(secret) = info.secret.as_ref() {
        let secret = format!("Bearer {}", secret.clone()).parse()?;
        headers.insert("Authorization", secret);
    }

    Ok((server, headers))
}

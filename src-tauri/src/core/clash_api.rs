use crate::config::Config;
use anyhow::Result;
use reqwest::header::HeaderMap;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rate {
    pub up: u64,
    pub down: u64,
}

/// 根据clash info获取clash服务地址和请求头
pub fn clash_client_info() -> Result<(String, HeaderMap)> {
    let client = { Config::clash().data().get_client_info() };

    let server = format!("http://{}", client.server);

    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse()?);

    if let Some(secret) = client.secret {
        let secret = format!("Bearer {}", secret).parse()?;
        headers.insert("Authorization", secret);
    }

    Ok((server, headers))
}

#[cfg(target_os = "macos")]
pub fn get_traffic_ws_url() -> Result<String> {
    let (url, _) = clash_client_info()?;
    let ws_url = url.replace("http://", "ws://") + "/traffic";
    Ok(ws_url)
}
use crate::config::Config;
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::collections::HashMap;

/// POST /restart
pub async fn restart_core() -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/restart");

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let _ = client.post(&url).headers(headers.clone()).send().await?;
    Ok(())
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ClashBasicConfig {
    /// only use tun config for now
    pub tun: Mapping,
}
/// GET /configs
pub async fn get_configs() -> Result<ClashBasicConfig> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs");

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let response = client.get(&url).headers(headers.clone()).send().await?;
    Ok(response.json::<ClashBasicConfig>().await?)
}

/// PUT /configs
/// path 是绝对路径
pub async fn put_configs(path: &str) -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs");
    let data = HashMap::from([("path", path)]);

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let response = client.put(&url).headers(headers).json(&data).send().await?;

    match response.status().as_u16() {
        204 => Ok(()),
        status => {
            bail!("failed to put configs with status \"{status}\"")
        }
    }
}

/// PATCH /configs
pub async fn patch_configs(config: &Mapping) -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs");

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let _ = client
        .patch(&url)
        .headers(headers.clone())
        .json(config)
        .send()
        .await?;
    Ok(())
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct DelayRes {
    delay: u64,
}

/// GET /proxies/{name}/delay
/// 获取代理延迟
pub async fn get_proxy_delay(
    name: String,
    test_url: Option<String>,
    timeout: i32,
) -> Result<DelayRes> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/proxies/{name}/delay");

    let default_url = "https://www.gstatic.com/generate_204";
    let test_url = test_url
        .map(|s| if s.is_empty() { default_url.into() } else { s })
        .unwrap_or(default_url.into());

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let response = client
        .get(&url)
        .headers(headers)
        .query(&[("timeout", &format!("{timeout}")), ("url", &test_url)])
        .send()
        .await?;

    Ok(response.json::<DelayRes>().await?)
}

/// 根据clash info获取clash服务地址和请求头
fn clash_client_info() -> Result<(String, HeaderMap)> {
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

/// 缩短clash的日志
#[allow(dead_code)]
pub fn parse_log(log: String) -> String {
    if log.starts_with("time=") && log.len() > 33 {
        return (log[33..]).to_owned();
    }
    if log.len() > 9 {
        return (log[9..]).to_owned();
    }
    log
}

/// 缩短clash -t的错误输出
/// 仅适配 clash p核 8-26、clash meta 1.13.1
pub fn parse_check_output(log: String) -> String {
    let t = log.find("time=");
    let m = log.find("msg=");
    let mr = log.rfind('"');

    if let (Some(_), Some(m), Some(mr)) = (t, m, mr) {
        let e = match log.find("level=error msg=") {
            Some(e) => e + 17,
            None => m + 5,
        };

        if mr > m {
            return (log[e..mr]).to_owned();
        }
    }

    let l = log.find("error=");
    let r = log.find("path=").or(Some(log.len()));

    if let (Some(l), Some(r)) = (l, r) {
        return (log[(l + 6)..(r - 1)]).to_owned();
    }

    log
}

#[test]
fn test_parse_check_output() {
    let str1 = r#"xxxx\n time="2022-11-18T20:42:58+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'""#;
    let str2 = r#"20:43:49 ERR [Config] configuration file test failed error=proxy 0: unsupport proxy type: hysteria path=xxx"#;
    let str3 = r#"
    "time="2022-11-18T21:38:01+08:00" level=info msg="Start initial configuration in progress"
    time="2022-11-18T21:38:01+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'"
    configuration file xxx\n
    "#;

    let res1 = parse_check_output(str1.into());
    let res2 = parse_check_output(str2.into());
    let res3 = parse_check_output(str3.into());

    println!("res1: {res1}");
    println!("res2: {res2}");
    println!("res3: {res3}");

    assert_eq!(res1, res3);
}

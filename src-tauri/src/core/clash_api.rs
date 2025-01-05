use crate::config::Config;
use anyhow::{bail, Result};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;
use std::collections::HashMap;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rate {
    pub up: u64,
    pub down: u64,
}

/// PUT /configs
/// path 是绝对路径
pub async fn put_configs(path: &str) -> Result<()> {
    let (url, headers) = clash_client_info()?;
    let url = format!("{url}/configs?force=true");

    let mut data = HashMap::new();
    data.insert("path", path);

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let builder = client.put(&url).headers(headers).json(&data);
    let response = builder.send().await?;

    match response.status().as_u16() {
        204 => Ok(()),
        status => {
            let body = response.text().await?;
           // print!("failed to put configs with status \"{}\"\n{}\n{}", status, url, body);
            bail!("failed to put configs with status \"{status}\"\n{url}\n{body}");
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

    let default_url = "http://cp.cloudflare.com/generate_204";
    let test_url = test_url
        .map(|s| if s.is_empty() { default_url.into() } else { s })
        .unwrap_or(default_url.into());

    let client = reqwest::ClientBuilder::new().no_proxy().build()?;
    let builder = client
        .get(&url)
        .headers(headers)
        .query(&[("timeout", &format!("{timeout}")), ("url", &test_url)]);
    let response = builder.send().await?;

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

#[allow(dead_code)]
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

#[cfg(target_os = "macos")]
pub fn get_traffic_ws_url() -> Result<String> {
    let (url, _) = clash_client_info()?;
    let ws_url = url.replace("http://", "ws://") + "/traffic";
    Ok(ws_url)
}

#[test]
fn test_parse_check_output() {
    let str1 = r#"xxxx\n time="2022-11-18T20:42:58+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'""#;
    //let str2 = r#"20:43:49 ERR [Config] configuration file test failed error=proxy 0: unsupport proxy type: hysteria path=xxx"#;
    let str3 = r#"
    "time="2022-11-18T21:38:01+08:00" level=info msg="Start initial configuration in progress"
    time="2022-11-18T21:38:01+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'"
    configuration file xxx\n
    "#;

    let res1 = parse_check_output(str1.into());
    // let res2 = parse_check_output(str2.into());
    let res3 = parse_check_output(str3.into());

    assert_eq!(res1, res3);
}

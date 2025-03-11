use std::collections::HashMap;

use reqwest::{Method, RequestBuilder};
use serde::Deserialize;
use serde_json::json;
use tauri::http::{HeaderMap, HeaderValue};

use crate::{
    BaseConfig, Connections, Error, GroupProxies, MihomoVersion, Protocol, Providers, Proxies,
    Proxy, ProxyDelay, ProxyProviders, Result, RuleProviders, Rules,
};

macro_rules! fail_resp {
    ($msg: expr) => {
        return Err(Error::FailedResponse(String::from($msg)))
    };
}

#[derive(Debug, Deserialize)]
pub struct Mihomo {
    pub protocol: Protocol,
    pub external_host: String,
    pub external_port: u32,
    pub secret: Option<String>,
}

impl Mihomo {
    pub fn new(
        protocol: Protocol,
        external_host: String,
        external_port: u32,
        secret: Option<String>,
    ) -> Self {
        Mihomo {
            protocol,
            external_host,
            external_port,
            secret,
        }
    }

    pub fn update_protocol(&mut self, protocol: Protocol) {
        self.protocol = protocol;
    }

    pub fn update_external_host<S: Into<String>>(&mut self, host: S) {
        self.external_host = host.into();
    }

    pub fn update_external_port(&mut self, port: u32) {
        self.external_port = port;
    }

    pub fn update_secret<S: Into<String>>(&mut self, secret: S) {
        self.secret = Some(secret.into());
    }

    fn get_req_url(&self, suffix_url: &str) -> Result<String> {
        if self.external_host.is_empty() {
            fail_resp!("not found external host, please set external host");
        }
        let server = format!(
            "{}://{}:{}{}",
            self.protocol, self.external_host, self.external_port, suffix_url
        );
        Ok(server)
    }

    fn get_req_headers(&self) -> Result<HeaderMap<HeaderValue>> {
        let mut headers = HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse()?);
        headers.insert("User-Agent", "tauri-plugin-mihomo".parse()?);
        if let Some(secret) = self.secret.clone() {
            let auth_value = format!("Bearer {}", secret).parse()?;
            headers.insert("Authorization", auth_value);
        }
        Ok(headers)
    }

    fn build_request(&self, method: Method, suffix_url: &str) -> Result<RequestBuilder> {
        let url = self.get_req_url(suffix_url)?;
        let headers = self.get_req_headers()?;
        let client = reqwest::ClientBuilder::new().build()?;
        match method {
            Method::POST => Ok(client.post(url).headers(headers)),
            Method::GET => Ok(client.get(url).headers(headers)),
            Method::PUT => Ok(client.put(url).headers(headers)),
            Method::PATCH => Ok(client.patch(url).headers(headers)),
            Method::DELETE => Ok(client.delete(url).headers(headers)),
            _ => Err(Error::MethodNotSupported(method.as_str().to_string())),
        }
    }

    pub async fn get_version(&self) -> Result<MihomoVersion> {
        let client = self.build_request(Method::GET, "/version")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get mihomo version erro");
        }
        Ok(response.json::<MihomoVersion>().await?)
    }

    pub async fn clean_fakeip(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/cache/fakeip/flush")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("clean fakeip cache error");
        }
        Ok(())
    }

    // connections
    pub async fn get_connections(&self) -> Result<Connections> {
        let client = self.build_request(Method::GET, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get connections failed");
        }
        Ok(response.json::<Connections>().await?)
    }

    pub async fn close_all_connections(&self) -> Result<()> {
        let client = self.build_request(Method::DELETE, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("close all connections failed");
        }
        Ok(())
    }

    pub async fn close_connection(&self, connection_id: &str) -> Result<()> {
        let client =
            self.build_request(Method::DELETE, &format!("/connections/{}", connection_id))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("close all connections failed");
        }
        Ok(())
    }

    // group
    pub async fn get_groups(&self) -> Result<GroupProxies> {
        let client = self.build_request(Method::GET, "/group")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get group error");
        }
        Ok(response.json::<GroupProxies>().await?)
    }

    pub async fn get_group_by_name(&self, group_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/group/{}", group_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get group error");
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
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get group error");
        }
        Ok(response.json::<HashMap<String, u32>>().await?)
    }

    // providers
    pub async fn get_proxies_providers(&self) -> Result<Providers> {
        let client = self.build_request(Method::GET, "/providers/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get providers proxy failed");
        }
        Ok(response.json::<Providers>().await?)
    }

    pub async fn get_providers_proxy_by_name(
        &self,
        providers_name: &str,
    ) -> Result<ProxyProviders> {
        let client = self.build_request(
            Method::GET,
            &format!("/providers/proxies/{}", providers_name),
        )?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get providers proxy failed");
        }
        Ok(response.json::<ProxyProviders>().await?)
    }

    pub async fn update_proxies_providers(&self, providers_name: &str) -> Result<()> {
        let client = self.build_request(
            Method::PUT,
            &format!("/providers/proxies/{}", providers_name),
        )?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("update providers proxy failed");
        }
        Ok(())
    }

    pub async fn healthcheck_providers(&self, providers_name: &str) -> Result<()> {
        let suffix_url = format!("/providers/proxies/{}/healthcheck", providers_name);
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("healthcheck providers failed");
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
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("healthcheck providers failed");
        }
        Ok(())
    }

    // proxies
    pub async fn get_proxies(&self) -> Result<Proxies> {
        let client = self.build_request(Method::GET, "/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get proxies failed");
        }
        Ok(response.json::<Proxies>().await?)
    }

    pub async fn get_proxy_by_name(&self, proxy_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/proxies/{}", proxy_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get proxy by name failed");
        }
        Ok(response.json::<Proxy>().await?)
    }

    pub async fn select_node_for_proxy(&self, proxy_name: &str, node: &str) -> Result<()> {
        let client = self.build_request(Method::PUT, &format!("/proxies/{}", proxy_name))?;
        let body = json!({
            "name": node
        });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            fail_resp!("select node for proxy failed");
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
        let client = self.build_request(Method::GET, &suffix_url)?;
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
                    fail_resp!("get proxy by name failed");
                }
            }
        }
        Ok(response.json::<ProxyDelay>().await?)
    }

    // rules
    pub async fn get_rules(&self) -> Result<Rules> {
        let client = self.build_request(Method::GET, "/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get rules failed");
        }
        Ok(response.json::<Rules>().await?)
    }

    pub async fn get_rules_providers(&self) -> Result<RuleProviders> {
        let client = self.build_request(Method::GET, "/providers/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get rules providers failed");
        }
        Ok(response.json::<RuleProviders>().await?)
    }

    pub async fn update_rules_providers(&self, providers_name: &str) -> Result<()> {
        let client =
            self.build_request(Method::PUT, &format!("/providers/rules/{}", providers_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("update rules providers failed");
        }
        Ok(())
    }

    // runtime config
    pub async fn get_base_config(&self) -> Result<BaseConfig> {
        let client = self.build_request(Method::GET, "/configs")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("get base config error");
        }
        Ok(response.json::<BaseConfig>().await?)
    }

    pub async fn reload_config(&self, force: bool, path: &str) -> Result<()> {
        let suffix_url = if force {
            "/configs".to_string()
        } else {
            format!("{}?force=true", "/configs")
        };
        let client = self.build_request(Method::PUT, &suffix_url)?;
        let body = json!({ "path": path });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            fail_resp!("reload base config error");
        }
        Ok(())
    }

    pub async fn patch_base_config<D: serde::Serialize + ?Sized>(&self, data: &D) -> Result<()> {
        let client = self.build_request(Method::PATCH, "/configs")?;
        let response = client.json(&data).send().await?;
        if !response.status().is_success() {
            fail_resp!(format!(
                "patch base config error, {:?}",
                response.text().await
            ));
        }
        Ok(())
    }

    pub async fn update_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/configs/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("update geo datebase error");
        }
        Ok(())
    }

    pub async fn restart(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/restart")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("restart core error");
        }
        Ok(())
    }

    // upgrade
    pub async fn upgrade_core(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            let res = response.json::<HashMap<String, String>>().await?;
            match res.get("message") {
                Some(msg) => {
                    if msg.contains("already using latest version") {
                        return Ok(());
                    }
                    fail_resp!(msg.clone());
                }
                None => {
                    fail_resp!("upgrade core failed");
                }
            }
        }
        Ok(())
    }

    pub async fn upgrade_ui(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/ui")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("upgrade ui failed");
        }
        Ok(())
    }

    pub async fn upgrade_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            fail_resp!("upgrade geo failed");
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use std::str::FromStr;

    use super::*;

    #[tokio::test]
    async fn test_upgrade_core() -> Result<()> {
        let value = serde_json::Value::from_str("{ \"mode\": \"direct\"}")?;
        let mihomo = Mihomo::new(
            Protocol::Http,
            "127.0.0.1".into(),
            9090,
            Some("ofY_JpdwekVcyO1DY3q61".into()),
        );
        let _ = mihomo.patch_base_config(&value).await?;
        Ok(())
    }
}

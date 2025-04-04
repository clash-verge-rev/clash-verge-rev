use std::collections::HashMap;

use reqwest::{Method, RequestBuilder};
use serde::Deserialize;
use serde_json::json;
use tauri::http::{HeaderMap, HeaderValue};

use crate::{
    BaseConfig, Connections, Error, GroupProxies, MihomoVersion, Protocol, Proxies, Proxy,
    ProxyDelay, ProxyProvider, ProxyProviders, Result, RuleProviders, Rules,
};

macro_rules! ret_err {
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
    #[allow(dead_code)]
    pub(crate) fn new(
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
            ret_err!("not found external host, please set external host");
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

    /// 获取 Mihomo 版本信息
    pub async fn get_version(&self) -> Result<MihomoVersion> {
        let client = self.build_request(Method::GET, "/version")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get mihomo version erro");
        }
        Ok(response.json::<MihomoVersion>().await?)
    }

    /// 清理 FakeIP 的缓存
    pub async fn clean_fakeip(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/cache/fakeip/flush")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("clean fakeip cache error");
        }
        Ok(())
    }

    /// 获取全部连接信息
    pub async fn get_connections(&self) -> Result<Connections> {
        let client = self.build_request(Method::GET, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get connections failed");
        }
        Ok(response.json::<Connections>().await?)
    }

    /// 关闭全部连接
    pub async fn close_all_connections(&self) -> Result<()> {
        let client = self.build_request(Method::DELETE, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("close all connections failed");
        }
        Ok(())
    }

    /// 关闭指定 ID 的连接
    pub async fn close_connection(&self, connection_id: &str) -> Result<()> {
        let client =
            self.build_request(Method::DELETE, &format!("/connections/{}", connection_id))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("close connection failed");
        }
        Ok(())
    }

    /// 获取所有的代理组
    pub async fn get_groups(&self) -> Result<GroupProxies> {
        let client = self.build_request(Method::GET, "/group")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get group error");
        }
        Ok(response.json::<GroupProxies>().await?)
    }

    /// 获取指定名称的代理组
    pub async fn get_group_by_name(&self, group_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/group/{}", group_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get group error");
        }
        Ok(response.json::<Proxy>().await?)
    }

    /// 对指定代理组进行延迟测试
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
            ret_err!("get group error");
        }
        Ok(response.json::<HashMap<String, u32>>().await?)
    }

    /// 获取代理提供者信息
    pub async fn get_proxy_providers(&self) -> Result<ProxyProviders> {
        let client = self.build_request(Method::GET, "/providers/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get providers proxy failed");
        }
        Ok(response.json::<ProxyProviders>().await?)
    }

    /// 获取指定代理提供者信息
    pub async fn get_proxy_provider_by_name(&self, provider_name: &str) -> Result<ProxyProvider> {
        let client = self.build_request(
            Method::GET,
            &format!("/providers/proxies/{}", provider_name),
        )?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get providers proxy failed");
        }
        Ok(response.json::<ProxyProvider>().await?)
    }

    /// 更新指定代理提供者信息
    pub async fn update_proxy_provider(&self, provider_name: &str) -> Result<()> {
        let client = self.build_request(
            Method::PUT,
            &format!("/providers/proxies/{}", provider_name),
        )?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("update providers proxy failed");
        }
        Ok(())
    }

    /// 对指定代理提供者进行健康检查
    pub async fn healthcheck_proxy_provider(&self, provider_name: &str) -> Result<()> {
        let suffix_url = format!("/providers/proxies/{}/healthcheck", provider_name);
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("healthcheck providers failed");
        }
        Ok(())
    }

    /// 对指定代理提供者下的指定节点（非代理组）进行健康检查, 并返回新的延迟信息
    pub async fn healthcheck_node_in_provider(
        &self,
        provider_name: &str,
        proxy_name: &str,
        test_url: &str,
        timeout: u32,
    ) -> Result<ProxyDelay> {
        let suffix_url = format!(
            "/providers/proxies/{}/{}/healthcheck?url={}&timeout={}",
            provider_name, proxy_name, test_url, timeout
        );
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("healthcheck providers failed");
        }
        Ok(response.json::<ProxyDelay>().await?)
    }

    /// 获取所有代理信息
    pub async fn get_proxies(&self) -> Result<Proxies> {
        let client = self.build_request(Method::GET, "/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get proxies failed");
        }
        Ok(response.json::<Proxies>().await?)
    }

    /// 获取指定代理信息
    pub async fn get_proxy_by_name(&self, proxy_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/proxies/{}", proxy_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get proxy by name failed");
        }
        Ok(response.json::<Proxy>().await?)
    }

    /// 为指定代理选择节点
    ///
    /// 一般为指定代理组下使用指定的代理节点 【代理组/节点】
    pub async fn select_node_for_proxy(&self, proxy_name: &str, node: &str) -> Result<()> {
        let client = self.build_request(Method::PUT, &format!("/proxies/{}", proxy_name))?;
        let body = json!({
            "name": node
        });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            ret_err!("select node for proxy failed");
        }
        Ok(())
    }

    /// 指定代理组下不再使用固定的代理节点
    ///
    /// 一般用于自动选择的代理组（例如：URLTest 类型的代理组）下的节点
    pub async fn unfixed_proxy(&self, group_name: &str) -> Result<()> {
        let client = self.build_request(Method::DELETE, &format!("/proxies/{}", group_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("unfixed proxy failed");
        }
        Ok(())
    }

    /// 对指定代理进行延迟测试
    ///
    /// 一般用于代理节点的延迟测试，也可传代理组名称（只会测试代理组下选中的代理节点）
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
                ("url", &test_url.to_string()),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            match response.json::<ProxyDelay>().await {
                Ok(delay) => {
                    return Ok(delay);
                }
                Err(_) => {
                    ret_err!("get proxy by name failed");
                }
            }
        }
        Ok(response.json::<ProxyDelay>().await?)
    }

    /// 获取所有规则信息
    pub async fn get_rules(&self) -> Result<Rules> {
        let client = self.build_request(Method::GET, "/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get rules failed");
        }
        Ok(response.json::<Rules>().await?)
    }

    /// 获取所有规则提供者信息
    pub async fn get_rule_providers(&self) -> Result<RuleProviders> {
        let client = self.build_request(Method::GET, "/providers/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get rules providers failed");
        }
        Ok(response.json::<RuleProviders>().await?)
    }

    /// 更新规则提供者信息
    pub async fn update_rule_provider(&self, provider_name: &str) -> Result<()> {
        let client =
            self.build_request(Method::PUT, &format!("/providers/rules/{}", provider_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("update rule provider failed");
        }
        Ok(())
    }

    /// 获取基础配置
    pub async fn get_base_config(&self) -> Result<BaseConfig> {
        let client = self.build_request(Method::GET, "/configs")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get base config error");
        }
        Ok(response.json::<BaseConfig>().await?)
    }

    /// 重新加载配置
    pub async fn reload_config(&self, force: bool, config_path: &str) -> Result<()> {
        let suffix_url = if force {
            "/configs".to_string()
        } else {
            format!("{}?force=true", "/configs")
        };
        let client = self.build_request(Method::PUT, &suffix_url)?;
        let body = json!({ "path": config_path });
        let response = client.json(&body).send().await?;
        if !response.status().is_success() {
            ret_err!("reload base config error");
        }
        Ok(())
    }

    /// 更新基础配置
    pub async fn patch_base_config<D: serde::Serialize + ?Sized>(&self, data: &D) -> Result<()> {
        let client = self.build_request(Method::PATCH, "/configs")?;
        let response = client.json(&data).send().await?;
        if !response.status().is_success() {
            ret_err!(format!(
                "patch base config error, {:?}",
                response.text().await
            ));
        }
        Ok(())
    }

    /// 更新 Geo
    pub async fn update_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/configs/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("update geo datebase error");
        }
        Ok(())
    }

    /// 重启核心
    pub async fn restart(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/restart")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("restart core error");
        }
        Ok(())
    }

    /// 升级核心
    pub async fn upgrade_core(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            let res = response.json::<HashMap<String, String>>().await?;
            match res.get("message") {
                Some(msg) => {
                    if msg.contains("already using latest version") {
                        ret_err!("already using latest version");
                    } else {
                        ret_err!(msg.clone());
                    }
                }
                None => {
                    ret_err!("upgrade core failed");
                }
            }
        }
        Ok(())
    }

    /// 更新 UI
    pub async fn upgrade_ui(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/ui")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("upgrade ui failed");
        }
        Ok(())
    }

    /// 更新 Geo
    pub async fn upgrade_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("upgrade geo failed");
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use std::str::FromStr;

    use super::*;

    fn mihomo() -> Mihomo {
        Mihomo::new(
            Protocol::Http,
            "127.0.0.1".into(),
            9090,
            Some("oA9xfLbi5OCbb9ByKaXDk".into()),
        )
    }

    #[tokio::test]
    async fn test_patch_base_config() -> Result<()> {
        let value = serde_json::Value::from_str("{ \"mode\": \"direct\"}")?;
        let _ = mihomo().patch_base_config(&value).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_get_rules() -> Result<()> {
        let rules = mihomo().get_rules().await?;
        println!("{:?}", rules.rules);
        Ok(())
    }

    #[tokio::test]
    async fn test_get_proxy_providers() -> Result<()> {
        let providers = mihomo().get_proxy_providers().await?;
        println!("{:?}", providers.providers);
        Ok(())
    }

    #[tokio::test]
    async fn test_upgrade_core() -> Result<()> {
        let _ = mihomo().upgrade_core().await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_unfixed_proxy() -> Result<()> {
        let _ = mihomo().unfixed_proxy("US AUTO").await?;
        Ok(())
    }
}

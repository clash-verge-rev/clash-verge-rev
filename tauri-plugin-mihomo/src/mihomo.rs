#![allow(dead_code)]
use crate::{
    BaseConfig, ConnectionId, Connections, Error, GroupProxies, MihomoVersion, Protocol, Providers,
    Proxies, Proxy, ProxyDelay, ProxyProviders, Result, RuleProviders, Rules, WebSocketWriter,
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderMap, HeaderValue};
use reqwest::{Method, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::ipc::Channel;
use tokio::sync::Mutex;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::CloseFrame as ProtocolCloseFrame, Message},
};

macro_rules! ret_err {
    ($msg: expr) => {
        return Err(Error::FailedResponse(String::from($msg)))
    };
}

#[derive(Debug, Default)]
pub struct ConnectionManager(Mutex<HashMap<ConnectionId, WebSocketWriter>>);

#[derive(Deserialize)]
#[serde(untagged, rename_all = "camelCase")]
pub(crate) enum Max {
    None,
    Number(usize),
}

#[derive(Deserialize, Serialize)]
pub(crate) struct CloseFrame {
    pub code: u16,
    pub reason: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", content = "data")]
pub(crate) enum WebSocketMessage {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close(Option<CloseFrame>),
}

#[derive(Debug)]
pub struct Mihomo {
    pub protocol: Protocol,
    pub external_host: String,
    pub external_port: u32,
    pub secret: Option<String>,
    pub connection_manager: Arc<ConnectionManager>,
}

impl Mihomo {
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
            connection_manager: Arc::new(ConnectionManager::default()),
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

    fn get_websocket_url(&self, suffix_url: &str) -> Result<String> {
        if self.external_host.is_empty() {
            ret_err!("not found external host, please set external host");
        }
        let mut ws_url = format!(
            "ws://{}:{}{}",
            self.external_host, self.external_port, suffix_url
        );
        if self.secret.is_some() {
            ws_url.push_str("?token=");
            ws_url.push_str(self.secret.as_ref().unwrap());
        }
        Ok(ws_url)
    }

    pub(crate) async fn connect(
        &self,
        url: String,
        on_message: Channel<serde_json::Value>,
    ) -> Result<ConnectionId> {
        let id = rand::random();
        let request = url.into_client_request()?;
        let manager = self.connection_manager.clone();

        let (ws_stream, _) = connect_async(request).await?;

        let (write, read) = ws_stream.split();
        manager.0.lock().await.insert(id, write);

        tauri::async_runtime::spawn(async move {
            read.for_each(move |message| {
                let on_message_ = on_message.clone();
                let manager_ = manager.clone();
                async move {
                    if let Ok(Message::Close(_)) = message {
                        manager_.0.lock().await.remove(&id);
                    }

                    let response = match message {
                        Ok(Message::Text(t)) => {
                            serde_json::to_value(WebSocketMessage::Text(t.to_string())).unwrap()
                        }
                        Ok(Message::Binary(t)) => {
                            serde_json::to_value(WebSocketMessage::Binary(t.to_vec())).unwrap()
                        }
                        Ok(Message::Ping(t)) => {
                            serde_json::to_value(WebSocketMessage::Ping(t.to_vec())).unwrap()
                        }
                        Ok(Message::Pong(t)) => {
                            serde_json::to_value(WebSocketMessage::Pong(t.to_vec())).unwrap()
                        }
                        Ok(Message::Close(t)) => {
                            serde_json::to_value(WebSocketMessage::Close(t.map(|v| CloseFrame {
                                code: v.code.into(),
                                reason: v.reason.to_string(),
                            })))
                            .unwrap()
                        }
                        Ok(Message::Frame(_)) => serde_json::Value::Null, // This value can't be recieved.
                        Err(e) => serde_json::to_value(Error::from(e)).unwrap(),
                    };

                    let _ = on_message_.send(response);
                }
            })
            .await;
        });

        Ok(id)
    }

    pub(crate) async fn send(&self, id: ConnectionId, message: WebSocketMessage) -> Result<()> {
        let manager = self.connection_manager.clone();
        let mut manager = manager.0.lock().await;
        if let Some(write) = manager.get_mut(&id) {
            write
                .send(match message {
                    WebSocketMessage::Text(t) => Message::Text(t.into()),
                    WebSocketMessage::Binary(t) => Message::Binary(t.into()),
                    WebSocketMessage::Ping(t) => Message::Ping(t.into()),
                    WebSocketMessage::Pong(t) => Message::Pong(t.into()),
                    WebSocketMessage::Close(t) => Message::Close(t.map(|v| ProtocolCloseFrame {
                        code: v.code.into(),
                        reason: v.reason.into(),
                    })),
                })
                .await?;
            Ok(())
        } else {
            Err(Error::ConnectionNotFound(id))
        }
    }

    pub(crate) async fn disconnect(
        &self,
        id: ConnectionId,
        force_timeout_secs: Option<u64>,
    ) -> Result<()> {
        let manager = self.connection_manager.clone();
        let manager_ = manager.clone();
        let mut manager = manager.0.lock().await;
        if let Some(write) = manager.get_mut(&id) {
            write
                .send(Message::Close(Some(ProtocolCloseFrame {
                    code: 1000.into(),
                    reason: "Disconnected by client".into(),
                })))
                .await?;
            if let Some(timeout) = force_timeout_secs {
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(timeout)).await;
                    manager_.0.lock().await.remove(&id);
                });
            }
            Ok(())
        } else {
            Err(Error::ConnectionNotFound(id))
        }
    }

    async fn get_connection(&self, id: ConnectionId) -> bool {
        let manager = self.connection_manager.clone();
        let manager = manager.0.lock().await;
        manager.get(&id).is_some()
    }

    // websocket
    pub async fn ws_traffic(&self, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/traffic")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    pub async fn ws_memory(&self, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/memory")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    pub async fn ws_connections(
        &self,
        on_message: Channel<serde_json::Value>,
    ) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/connections")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    pub async fn ws_logs(
        &self,
        level: String,
        on_message: Channel<serde_json::Value>,
    ) -> Result<ConnectionId> {
        let mut ws_url = self.get_websocket_url("/logs")?;
        if self.secret.is_some() {
            ws_url.push_str(&format!("&level={}", level));
        } else {
            ws_url.push_str(&format!("?level={}", level));
        }
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    // clash api
    pub async fn get_version(&self) -> Result<MihomoVersion> {
        let client = self.build_request(Method::GET, "/version")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get mihomo version erro");
        }
        Ok(response.json::<MihomoVersion>().await?)
    }

    pub async fn clean_fakeip(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/cache/fakeip/flush")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("clean fakeip cache error");
        }
        Ok(())
    }

    // connections
    pub async fn get_connections(&self) -> Result<Connections> {
        let client = self.build_request(Method::GET, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get connections failed");
        }
        Ok(response.json::<Connections>().await?)
    }

    pub async fn close_all_connections(&self) -> Result<()> {
        let client = self.build_request(Method::DELETE, "/connections")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("close all connections failed");
        }
        Ok(())
    }

    pub async fn close_connection(&self, connection_id: &str) -> Result<()> {
        let client =
            self.build_request(Method::DELETE, &format!("/connections/{}", connection_id))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("close all connections failed");
        }
        Ok(())
    }

    // group
    pub async fn get_groups(&self) -> Result<GroupProxies> {
        let client = self.build_request(Method::GET, "/group")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get group error");
        }
        Ok(response.json::<GroupProxies>().await?)
    }

    pub async fn get_group_by_name(&self, group_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/group/{}", group_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get group error");
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
            ret_err!("get group error");
        }
        Ok(response.json::<HashMap<String, u32>>().await?)
    }

    // providers
    pub async fn get_proxies_providers(&self) -> Result<Providers> {
        let client = self.build_request(Method::GET, "/providers/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get providers proxy failed");
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
            ret_err!("get providers proxy failed");
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
            ret_err!("update providers proxy failed");
        }
        Ok(())
    }

    pub async fn healthcheck_providers(&self, providers_name: &str) -> Result<()> {
        let suffix_url = format!("/providers/proxies/{}/healthcheck", providers_name);
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("healthcheck providers failed");
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
            ret_err!("healthcheck providers failed");
        }
        Ok(())
    }

    // proxies
    pub async fn get_proxies(&self) -> Result<Proxies> {
        let client = self.build_request(Method::GET, "/proxies")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get proxies failed");
        }
        Ok(response.json::<Proxies>().await?)
    }

    pub async fn get_proxy_by_name(&self, proxy_name: &str) -> Result<Proxy> {
        let client = self.build_request(Method::GET, &format!("/proxies/{}", proxy_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get proxy by name failed");
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
            ret_err!("select node for proxy failed");
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

    // rules
    pub async fn get_rules(&self) -> Result<Rules> {
        let client = self.build_request(Method::GET, "/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get rules failed");
        }
        Ok(response.json::<Rules>().await?)
    }

    pub async fn get_rules_providers(&self) -> Result<RuleProviders> {
        let client = self.build_request(Method::GET, "/providers/rules")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get rules providers failed");
        }
        Ok(response.json::<RuleProviders>().await?)
    }

    pub async fn update_rules_providers(&self, providers_name: &str) -> Result<()> {
        let client =
            self.build_request(Method::PUT, &format!("/providers/rules/{}", providers_name))?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("update rules providers failed");
        }
        Ok(())
    }

    // runtime config
    pub async fn get_base_config(&self) -> Result<BaseConfig> {
        let client = self.build_request(Method::GET, "/configs")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("get base config error");
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
            ret_err!("reload base config error");
        }
        Ok(())
    }

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

    pub async fn update_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/configs/geo")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("update geo datebase error");
        }
        Ok(())
    }

    pub async fn restart(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/restart")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("restart core error");
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

    pub async fn upgrade_ui(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/ui")?;
        let response = client.send().await?;
        if !response.status().is_success() {
            ret_err!("upgrade ui failed");
        }
        Ok(())
    }

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
    use std::{str::FromStr, time::Duration};

    use tauri::ipc::InvokeResponseBody;

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
    async fn test_get_proxies_providers() -> Result<()> {
        let providers = mihomo().get_proxies_providers().await?;
        println!("{:?}", providers.providers);
        Ok(())
    }

    #[tokio::test]
    async fn test_upgrade_core() -> Result<()> {
        let _ = mihomo().upgrade_core().await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_ws_traffic() -> Result<()> {
        let mihomo = mihomo();
        let on_message = Channel::new(|message| {
            match message {
                InvokeResponseBody::Json(msg) => {
                    println!("Received JSON message: {}", msg);
                }
                InvokeResponseBody::Raw(raw) => {
                    println!(
                        "Received raw message: {}",
                        String::from_utf8(raw).unwrap().to_string()
                    );
                }
            }
            Ok(())
        });
        let websocket_id = mihomo.ws_logs("info".into(), on_message).await?;
        // let websocket_id = mihomo
        //     .connect("ws://toolin.cn/echo".into(), on_message)
        //     .await?;
        println!("WebSocket ID: {}", websocket_id);
        tokio::time::sleep(Duration::from_millis(3000)).await;
        mihomo.disconnect(websocket_id, Some(5)).await?;
        for i in 0..10 {
            println!("check connection exist {}", i);
            if !mihomo.get_connection(websocket_id).await {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Ok(())
    }
}

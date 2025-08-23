#![allow(dead_code)]
use crate::{
    BaseConfig, Connections, Error, GroupProxies, MihomoVersion, Protocol, Proxies, Proxy, ProxyDelay, ProxyProvider,
    ProxyProviders, Result, RuleProviders, Rules, failed_rep, ipc_request::LocalSocket, utils,
};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use http::{
    HeaderMap, HeaderValue, Request,
    header::{AUTHORIZATION, CONNECTION, CONTENT_TYPE, HOST, SEC_WEBSOCKET_KEY, SEC_WEBSOCKET_VERSION, UPGRADE},
};
use reqwest::{Method, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::ipc::Channel;
use tokio::net::TcpStream;
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(windows)]
use tokio::net::windows::named_pipe::NamedPipeClient;
use tokio::sync::RwLock;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, client_async, connect_async,
    tungstenite::{Message, client::IntoClientRequest, protocol::CloseFrame as ProtocolCloseFrame},
};

pub(crate) type ConnectionId = u32;
pub(crate) enum WebSocketWriter {
    TcpStreamWriter(SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>),
    #[cfg(unix)]
    UnixStreamWriter(SplitSink<WebSocketStream<UnixStream>, Message>),
    #[cfg(windows)]
    NamedPipeWriter(SplitSink<WebSocketStream<NamedPipeClient>, Message>),
}

impl WebSocketWriter {
    pub async fn send(&mut self, message: Message) -> Result<()> {
        match self {
            WebSocketWriter::TcpStreamWriter(write) => {
                write.send(message).await?;
            }
            #[cfg(unix)]
            WebSocketWriter::UnixStreamWriter(write) => {
                write.send(message).await?;
            }
            #[cfg(windows)]
            WebSocketWriter::NamedPipeWriter(write) => {
                write.send(message).await?;
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct ConnectionManager(RwLock<HashMap<ConnectionId, WebSocketWriter>>);

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

// #[derive(Debug)]
pub struct Mihomo {
    pub protocol: Protocol,
    pub external_host: Option<String>,
    pub external_port: Option<u32>,
    pub secret: Option<String>,
    pub socket_path: Option<String>,
    pub connection_manager: Arc<ConnectionManager>,
}

impl Mihomo {
    pub(crate) fn new(
        protocol: Protocol,
        external_host: Option<String>,
        external_port: Option<u32>,
        secret: Option<String>,
        socket_path: Option<String>,
    ) -> Self {
        Mihomo {
            protocol,
            external_host,
            external_port,
            secret,
            socket_path,
            connection_manager: Arc::new(ConnectionManager::default()),
        }
    }

    pub fn update_protocol(&mut self, protocol: Protocol) {
        self.protocol = protocol;
    }

    pub fn update_external_host(&mut self, host: Option<String>) {
        self.external_host = host;
    }

    pub fn update_external_port(&mut self, port: Option<u32>) {
        self.external_port = port;
    }

    pub fn update_secret(&mut self, secret: Option<String>) {
        self.secret = secret;
    }

    pub fn update_socket_path<S: Into<String>>(&mut self, socket_path: S) {
        self.socket_path = Some(socket_path.into());
    }

    fn get_req_url(&self, suffix_url: &str) -> Result<String> {
        let suffix_url = suffix_url.trim_start_matches("/");
        match self.protocol {
            Protocol::Http => {
                if let Some(host) = self.external_host.as_ref() {
                    let port = self.external_port.unwrap_or(9090);
                    Ok(format!("http://{host}:{port}/{suffix_url}"))
                } else {
                    log::error!("missing external host parameter");
                    Err(Error::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "missing external host".to_string(),
                    )))
                }
            }
            Protocol::LocalSocket => Ok(format!("http://localhost/{suffix_url}")),
        }
    }

    fn get_req_headers(&self) -> Result<HeaderMap<HeaderValue>> {
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_str("localhost")?);
        headers.insert(CONTENT_TYPE, HeaderValue::from_str("application/json")?);
        if matches!(self.protocol, Protocol::Http)
            && let Some(secret) = &self.secret
        {
            let auth_value = HeaderValue::from_str(&format!("Bearer {secret}"))?;
            headers.insert(AUTHORIZATION, auth_value);
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
            _ => {
                let method_str = method.as_str().to_string();
                log::error!("method not supported: {method_str}");
                Err(Error::MethodNotSupported(method_str))
            }
        }
    }

    async fn send_by_protocol(&self, client: RequestBuilder) -> Result<reqwest::Response> {
        match self.protocol {
            Protocol::Http => client.send().await.map_err(Error::Reqwest),
            Protocol::LocalSocket => {
                if let Some(socket_path) = self.socket_path.as_ref() {
                    log::debug!("send to local socket: {socket_path}");
                    client.send_by_local_socket(socket_path).await
                } else {
                    log::error!("missing socket path parameter");
                    Err(Error::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "missing socket path".to_string(),
                    )))
                }
            }
        }
    }

    fn get_websocket_url(&self, suffix_url: &str) -> Result<String> {
        let suffix_url = suffix_url.trim_start_matches("/");
        match self.protocol {
            Protocol::Http => {
                if let Some(host) = self.external_host.as_ref() {
                    let port = self.external_port.unwrap_or(9090);
                    let secret = self.secret.as_deref().unwrap_or_default();
                    Ok(format!("ws://{host}:{port}/{suffix_url}?token={secret}"))
                } else {
                    log::error!("missing external host parameter");
                    Err(Error::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "missing external host".to_string(),
                    )))
                }
            }
            Protocol::LocalSocket => Ok(format!("ws://localhost/{suffix_url}")),
        }
    }

    /// 连接 WebSocket
    async fn connect(&self, url: String, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let id = rand::random();
        log::info!("connecting to websocket: {url}, id: {id}");
        let manager = self.connection_manager.clone();
        let handle_message = |message| {
            // log::trace!("handle message {message:?}");
            match message {
                Ok(Message::Text(t)) => serde_json::to_value(WebSocketMessage::Text(t.to_string())).unwrap(),
                Ok(Message::Binary(t)) => serde_json::to_value(WebSocketMessage::Binary(t.to_vec())).unwrap(),
                Ok(Message::Ping(t)) => serde_json::to_value(WebSocketMessage::Ping(t.to_vec())).unwrap(),
                Ok(Message::Pong(t)) => serde_json::to_value(WebSocketMessage::Pong(t.to_vec())).unwrap(),
                Ok(Message::Close(t)) => serde_json::to_value(WebSocketMessage::Close(t.map(|v| CloseFrame {
                    code: v.code.into(),
                    reason: v.reason.to_string(),
                })))
                .unwrap(),
                Ok(Message::Frame(_)) => serde_json::Value::Null, // This value can't be received.
                Err(e) => {
                    log::error!("websocket error: {e}");
                    serde_json::to_value(WebSocketMessage::Text(Error::from(e).to_string())).unwrap()
                }
            }
        };

        match self.protocol {
            Protocol::Http => {
                log::debug!("starting connect to websocket by using http");
                let request = url.into_client_request()?;
                let (ws_stream, _) = connect_async(request).await?;
                let (writer, mut reader) = ws_stream.split();
                {
                    manager
                        .0
                        .write()
                        .await
                        .insert(id, WebSocketWriter::TcpStreamWriter(writer));
                }

                tauri::async_runtime::spawn(async move {
                    let on_message_ = on_message.clone();
                    let manager_ = manager.clone();
                    loop {
                        let ids: Vec<u32> = manager_.0.read().await.keys().cloned().collect();
                        log::trace!("waiting for websocket message, connection_id: {id}, manager_ids: {ids:?}",);
                        if !ids.contains(&id) {
                            log::debug!("connection [{id}] is removed from manager");
                            break;
                        }
                        if let Some(message) = reader.next().await {
                            if let Ok(Message::Close(_)) = message {
                                log::debug!("connection [{id}] is closed");
                                manager_.0.write().await.remove(&id);
                            }
                            let response = handle_message(message);
                            let _ = on_message_.send(response);
                        }
                    }
                });

                Ok(id)
            }
            Protocol::LocalSocket => {
                if let Some(socket_path) = self.socket_path.as_ref() {
                    log::debug!("starting connect to websocket by using local socket: {socket_path}");
                    let stream = {
                        #[cfg(unix)]
                        {
                            use std::path::Path;
                            use tokio::net::UnixStream;
                            if !Path::new(socket_path).exists() {
                                log::error!("socket path is not exists: {socket_path}");
                                return Err(Error::Io(std::io::Error::new(
                                    std::io::ErrorKind::NotFound,
                                    format!("socket path: {socket_path} not found"),
                                )));
                            }
                            UnixStream::connect(socket_path).await?
                        }

                        #[cfg(windows)]
                        {
                            use tokio::net::windows::named_pipe::ClientOptions;
                            use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
                            loop {
                                match ClientOptions::new().open(socket_path) {
                                    Ok(client) => break client,
                                    Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {}
                                    Err(e) => {
                                        log::error!("failed to connect to named pipe: {socket_path}, {e}");
                                        return Err(Error::FailedResponse(format!(
                                            "Failed to connect to named pipe: {socket_path}, {e}"
                                        )));
                                    }
                                }
                                tokio::time::sleep(Duration::from_millis(50)).await;
                            }
                        }
                    };

                    let request = Request::builder()
                        .uri(url)
                        .header(HOST, "clash-verge")
                        .header(SEC_WEBSOCKET_KEY, utils::generate_websocket_key())
                        .header(CONNECTION, "Upgrade")
                        .header(UPGRADE, "websocket")
                        .header(SEC_WEBSOCKET_VERSION, "13")
                        .body(())?;
                    let (ws_stream, _) = client_async(request, stream).await?;
                    let (writer, mut reader) = ws_stream.split();
                    {
                        // save writer stream
                        #[cfg(unix)]
                        manager
                            .0
                            .write()
                            .await
                            .insert(id, WebSocketWriter::UnixStreamWriter(writer));
                        #[cfg(windows)]
                        manager
                            .0
                            .write()
                            .await
                            .insert(id, WebSocketWriter::NamedPipeWriter(writer));
                    }

                    tauri::async_runtime::spawn(async move {
                        let on_message_ = on_message.clone();
                        let manager_ = manager.clone();
                        loop {
                            let ids: Vec<u32> = manager_.0.read().await.keys().cloned().collect();
                            log::trace!("waiting for websocket message, connection_id: {id}, manager_ids: {ids:?}",);
                            if !ids.contains(&id) {
                                log::debug!("connection [{id}] is removed from manager");
                                break;
                            }
                            if let Some(message) = reader.next().await {
                                if let Ok(Message::Close(_)) = message {
                                    log::debug!("connection [{id}] closed");
                                    manager_.0.write().await.remove(&id);
                                }
                                let response = handle_message(message);
                                let _ = on_message_.send(response);
                            }
                        }
                    });
                    Ok(id)
                } else {
                    log::error!("missing socket path parameter");
                    Err(Error::Io(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "missing socket path".to_string(),
                    )))
                }
            }
        }
    }

    /// 向指定 WebSocket 连接发送消息 (暂无使用该方法的地方)
    async fn send(&self, id: ConnectionId, message: WebSocketMessage) -> Result<()> {
        let manager = self.connection_manager.clone();
        let mut manager = manager.0.write().await;
        if let Some(write) = manager.get_mut(&id) {
            let data = match message {
                WebSocketMessage::Text(t) => Message::Text(t.into()),
                WebSocketMessage::Binary(t) => Message::Binary(t.into()),
                WebSocketMessage::Ping(t) => Message::Ping(t.into()),
                WebSocketMessage::Pong(t) => Message::Pong(t.into()),
                WebSocketMessage::Close(t) => Message::Close(t.map(|v| ProtocolCloseFrame {
                    code: v.code.into(),
                    reason: v.reason.into(),
                })),
            };
            write.send(data).await?;
            Ok(())
        } else {
            log::error!("connection not found: {id}");
            Err(Error::ConnectionNotFound(id))
        }
    }

    /// 取消 WebSocket 连接
    pub(crate) async fn disconnect(&self, id: ConnectionId, force_timeout: Option<u64>) -> Result<()> {
        log::debug!("disconnecting connection: {id}");
        let mut manager = self.connection_manager.0.write().await;
        if let Some(writer) = manager.get_mut(&id) {
            let close_message = Message::Close(Some(ProtocolCloseFrame {
                code: 1000.into(),
                reason: "Disconnected by client".into(),
            }));
            writer.send(close_message).await?;
            if let Some(timeout) = force_timeout {
                let manager_ = self.connection_manager.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(timeout)).await;
                    log::debug!("force close websocket connection");
                    manager_.0.write().await.remove(&id);
                });
            }
            Ok(())
        } else {
            log::error!("connection not found: {id}");
            Err(Error::ConnectionNotFound(id))
        }
    }

    async fn get_connection(&self, id: ConnectionId) -> bool {
        let manager = self.connection_manager.clone();
        let manager = manager.0.read().await;
        manager.get(&id).is_some()
    }

    pub async fn clear_all_ws_connections(&self) -> Result<()> {
        log::debug!("start to clear all websocket connections");
        let mut manager = self.connection_manager.0.write().await;
        log::debug!("manage_ids: {:?}", manager.keys());
        manager.clear();
        log::debug!("clear all done, manager_ids: {:?}", manager.keys());
        Ok(())
    }

    /// WebSocket: Mihomo 流量数据
    pub async fn ws_traffic(&self, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/traffic")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    /// WebSocket: Mihomo 内存使用数据
    pub async fn ws_memory(&self, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/memory")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    /// WebSocket: Mihomo 连接信息数据
    pub async fn ws_connections(&self, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/connections")?;
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    /// WebSocket: Mihomo 日志数据
    pub async fn ws_logs(&self, level: &str, on_message: Channel<serde_json::Value>) -> Result<ConnectionId> {
        let ws_url = self.get_websocket_url("/logs")?;
        let ws_url = match self.protocol {
            // url 后面添加 format=structured 参数的日志格式如下：
            // {"time":"11:49:58","level":"debug","message":"[DNS] hijack udp:192.168.2.1:53 from 198.18.0.1:42761","fields":[]}
            Protocol::Http => format!("{ws_url}&level={level}"),
            Protocol::LocalSocket => format!("{ws_url}?level={level}"),
        };
        let websocket_id = self.connect(ws_url, on_message).await?;
        Ok(websocket_id)
    }

    // clash api
    /// 获取 Mihomo 版本信息
    pub async fn get_version(&self) -> Result<MihomoVersion> {
        let client = self.build_request(Method::GET, "/version")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get mihomo version error, {}", response.text().await?);
        }
        Ok(response.json::<MihomoVersion>().await?)
    }

    /// 清理 FakeIP 缓存
    pub async fn flush_fakeip(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/cache/fakeip/flush")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("flush fakeip cache error, {}", response.text().await?);
        }
        Ok(())
    }

    /// 清理 DNS 缓存
    pub async fn flush_dns(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/cache/dns/flush")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("flush dns cache error, {}", response.text().await?);
        }
        Ok(())
    }

    /// 获取全部连接信息
    pub async fn get_connections(&self) -> Result<Connections> {
        let client = self.build_request(Method::GET, "/connections")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get connections failed, {}", response.text().await?);
        }
        Ok(response.json::<Connections>().await?)
    }

    /// 关闭全部连接
    pub async fn close_all_connections(&self) -> Result<()> {
        let client = self.build_request(Method::DELETE, "/connections")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("close all connections failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 关闭指定 ID 的连接
    pub async fn close_connection(&self, connection_id: &str) -> Result<()> {
        let client = self.build_request(Method::DELETE, &format!("/connections/{connection_id}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("close connection failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 获取所有的代理组
    pub async fn get_groups(&self) -> Result<GroupProxies> {
        let client = self.build_request(Method::GET, "/group")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get group error, {}", response.text().await?);
        }
        Ok(response.json::<GroupProxies>().await?)
    }

    /// 获取指定名称的代理组
    pub async fn get_group_by_name(&self, group_name: &str) -> Result<Proxy> {
        let group_name = urlencoding::encode(group_name);
        let client = self.build_request(Method::GET, &format!("/group/{group_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get group error, {}", response.text().await?);
        }
        Ok(response.json::<Proxy>().await?)
    }

    /// 对指定代理组进行延迟测试
    pub async fn delay_group(&self, group_name: &str, test_url: &str, timeout: u32) -> Result<HashMap<String, u32>> {
        let group_name = urlencoding::encode(group_name);
        let test_url = urlencoding::encode(test_url);
        let suffix_url = format!("/group/{group_name}/delay?url={test_url}&timeout={timeout}");
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get group error, {}", response.text().await?);
        }
        Ok(response.json::<HashMap<String, u32>>().await?)
    }

    /// 获取代理提供者信息
    pub async fn get_proxy_providers(&self) -> Result<ProxyProviders> {
        let client = self.build_request(Method::GET, "/providers/proxies")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get providers proxy failed, {}", response.text().await?);
        }
        Ok(response.json::<ProxyProviders>().await?)
    }

    /// 获取指定代理提供者信息
    pub async fn get_proxy_provider_by_name(&self, provider_name: &str) -> Result<ProxyProvider> {
        let provider_name = urlencoding::encode(provider_name);
        let client = self.build_request(Method::GET, &format!("/providers/proxies/{provider_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get providers proxy failed, {}", response.text().await?);
        }
        Ok(response.json::<ProxyProvider>().await?)
    }

    /// 更新指定代理提供者信息
    pub async fn update_proxy_provider(&self, provider_name: &str) -> Result<()> {
        let provider_name = urlencoding::encode(provider_name);
        let client = self.build_request(Method::PUT, &format!("/providers/proxies/{provider_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("update providers proxy failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 对指定代理提供者进行健康检查
    pub async fn healthcheck_proxy_provider(&self, provider_name: &str) -> Result<()> {
        let provider_name = urlencoding::encode(provider_name);
        let suffix_url = format!("/providers/proxies/{provider_name}/healthcheck");
        let client = self.build_request(Method::GET, &suffix_url)?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("healthcheck providers failed, {}", response.text().await?);
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
        let provider_name = urlencoding::encode(provider_name);
        let proxy_name = urlencoding::encode(proxy_name);
        let suffix_url = format!("/providers/proxies/{provider_name}/{proxy_name}/healthcheck",);
        let client = self
            .build_request(Method::GET, &suffix_url)?
            .query(&[("url", test_url), ("timeout", &timeout.to_string())]);
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("healthcheck providers failed, {}", response.text().await?);
        }
        Ok(response.json::<ProxyDelay>().await?)
    }

    /// 获取所有代理信息
    pub async fn get_proxies(&self) -> Result<Proxies> {
        let client = self.build_request(Method::GET, "/proxies")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get proxies failed, {}", response.text().await?);
        }
        Ok(response.json::<Proxies>().await?)
    }

    /// 获取指定代理信息
    pub async fn get_proxy_by_name(&self, proxy_name: &str) -> Result<Proxy> {
        let proxy_name = urlencoding::encode(proxy_name);
        let client = self.build_request(Method::GET, &format!("/proxies/{proxy_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get proxy by name failed, {}", response.text().await?);
        }
        Ok(response.json::<Proxy>().await?)
    }

    /// 为指定代理选择节点
    ///
    /// 一般为指定代理组下使用指定的代理节点 【代理组/节点】
    pub async fn select_node_for_proxy(&self, proxy_name: &str, node: &str) -> Result<()> {
        let proxy_name = urlencoding::encode(proxy_name);
        let body = json!({ "name": node });
        let client = self
            .build_request(Method::PUT, &format!("/proxies/{proxy_name}"))?
            .json(&body);
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("select node for proxy failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 指定代理组下不再使用固定的代理节点
    ///
    /// 一般用于自动选择的代理组（例如：URLTest 类型的代理组）下的节点
    pub async fn unfixed_proxy(&self, group_name: &str) -> Result<()> {
        let group_name = urlencoding::encode(group_name);
        let client = self.build_request(Method::DELETE, &format!("/proxies/{group_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("unfixed proxy failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 对指定代理进行延迟测试
    ///
    /// 一般用于代理节点的延迟测试，也可传代理组名称（只会测试代理组下选中的代理节点）
    pub async fn delay_proxy_by_name(&self, proxy_name: &str, test_url: &str, timeout: u32) -> Result<ProxyDelay> {
        let proxy_name = urlencoding::encode(proxy_name);
        let suffix_url = format!("/proxies/{proxy_name}/delay");
        let client = self
            .build_request(Method::GET, &suffix_url)?
            .query(&[("timeout", &timeout.to_string()), ("url", &test_url.to_string())]);

        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            // maybe proxy delay is timeout response, parse it.
            match response.json::<ProxyDelay>().await {
                Ok(delay) => {
                    return Ok(delay);
                }
                Err(e) => {
                    failed_rep!("get proxy by name failed, {}", e);
                }
            }
        }
        Ok(response.json::<ProxyDelay>().await?)
    }

    /// 获取所有规则信息
    pub async fn get_rules(&self) -> Result<Rules> {
        let client = self.build_request(Method::GET, "/rules")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get rules failed, {}", response.text().await?);
        }
        Ok(response.json::<Rules>().await?)
    }

    /// 获取所有规则提供者信息
    pub async fn get_rule_providers(&self) -> Result<RuleProviders> {
        let client = self.build_request(Method::GET, "/providers/rules")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get rules providers failed, {}", response.text().await?);
        }
        Ok(response.json::<RuleProviders>().await?)
    }

    /// 更新规则提供者信息
    pub async fn update_rule_provider(&self, provider_name: &str) -> Result<()> {
        let provider_name = urlencoding::encode(provider_name);
        let client = self.build_request(Method::PUT, &format!("/providers/rules/{provider_name}"))?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("update rule provider failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 获取基础配置
    pub async fn get_base_config(&self) -> Result<BaseConfig> {
        let client = self.build_request(Method::GET, "/configs")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("get base config error, {}", response.text().await?);
        }
        Ok(response.json::<BaseConfig>().await?)
    }

    /// 重新加载配置
    pub async fn reload_config(&self, force: bool, config_path: &str) -> Result<()> {
        let body = json!({ "path": config_path });
        let client = self
            .build_request(Method::PUT, "/configs")?
            .query(&[("force", &force.to_string())])
            .json(&body);

        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("reload base config error, {}", response.text().await?);
        }
        Ok(())
    }

    /// 更新基础配置
    pub async fn patch_base_config<D: serde::Serialize + ?Sized>(&self, data: &D) -> Result<()> {
        let client = self.build_request(Method::PATCH, "/configs")?.json(&data);

        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("patch base config error, {}", response.text().await?);
        }
        Ok(())
    }

    /// 更新 Geo
    pub async fn update_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/configs/geo")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("update geo database error, {}", response.text().await?);
        }
        Ok(())
    }

    /// 重启核心
    pub async fn restart(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/restart")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("restart core failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 升级核心
    pub async fn upgrade_core(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            match response.json::<HashMap<String, String>>().await {
                Ok(res) => match res.get("message") {
                    Some(msg) => {
                        if msg.to_lowercase().contains("already using latest version") {
                            failed_rep!("already using latest version");
                        } else {
                            failed_rep!("{}", msg.clone());
                        }
                    }
                    None => {
                        failed_rep!("upgrade core failed");
                    }
                },
                Err(e) => {
                    failed_rep!("upgrade core failed, {}", e);
                }
            }
        }
        Ok(())
    }

    /// 更新 UI
    pub async fn upgrade_ui(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/ui")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("upgrade ui failed, {}", response.text().await?);
        }
        Ok(())
    }

    /// 更新 Geo
    pub async fn upgrade_geo(&self) -> Result<()> {
        let client = self.build_request(Method::POST, "/upgrade/geo")?;
        let response = self.send_by_protocol(client).await?;
        if !response.status().is_success() {
            failed_rep!("upgrade geo failed, {}", response.text().await?);
        }
        Ok(())
    }
}

// -------------------------------------------------------------
// |                      test mihomo api                      |
// -------------------------------------------------------------
#[cfg(test)]
mod test {
    use super::*;
    use crate::{ClashMode, Traffic};
    use std::time::Duration;
    use tauri::ipc::InvokeResponseBody;

    fn mihomo() -> Mihomo {
        let socket_path = if cfg!(unix) {
            "/tmp/verge-mihomo.sock".to_string()
        } else {
            r"\\.\pipe\verge-mihomo".to_string()
        };
        Mihomo::new(
            Protocol::Http,
            Some("127.0.0.1".into()),
            Some(9090),
            None, // no secret
            // Some("ppr7qxGrVBu9E8dUX3BoS".into()), // has secret
            Some(socket_path),
        )
    }

    #[tokio::test]
    async fn test_flush_dns() -> Result<()> {
        let mihomo = mihomo();
        mihomo.flush_dns().await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_get_base_config() -> Result<()> {
        let mihomo = mihomo();
        let config = mihomo.get_base_config().await?;
        println!("{config:?}");
        Ok(())
    }

    #[tokio::test]
    #[allow(unused_variables)]
    async fn test_patch_base_config() -> Result<()> {
        let mihomo = mihomo();
        let body = json!({
           "mode": "direct"
        });
        // let value = serde_json::Value::from_str("{ \"tun\": {\"enable\": true}}")?;
        mihomo.patch_base_config(&body).await?;
        let config = mihomo.get_base_config().await?;
        println!("mode: {}", config.mode);
        assert_eq!(config.mode, ClashMode::Direct);
        println!("---------------------------------");
        let body = json!({
           "mode": "rule"
        });
        mihomo.patch_base_config(&body).await?;
        let config = mihomo.get_base_config().await?;
        println!("mode: {}", config.mode);
        assert_eq!(config.mode, ClashMode::Rule);
        Ok(())
    }

    #[tokio::test]
    async fn test_get_rules() -> Result<()> {
        let mihomo = mihomo();
        let rules = mihomo.get_rules().await?;
        println!("{:?}", rules.rules);
        Ok(())
    }

    #[tokio::test]
    async fn test_get_groups() -> Result<()> {
        let mihomo = mihomo();
        let groups = mihomo.get_groups().await?;
        println!("{groups:?}");
        Ok(())
    }

    #[tokio::test]
    async fn test_unfixed_proxy() -> Result<()> {
        let mihomo = mihomo();
        mihomo.unfixed_proxy("US AUTO").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_get_proxy_providers() -> Result<()> {
        let mihomo = mihomo();
        let providers = mihomo.get_proxy_providers().await?;
        println!("{:?}", providers.providers);
        Ok(())
    }

    #[tokio::test]
    async fn test_spawn_delay_proxies() -> Result<()> {
        let mut mihomo = mihomo();
        mihomo.update_protocol(Protocol::LocalSocket);
        let proxies = [
            "AUTO",
            "HK AUTO",
            "TW AUTO",
            "JP AUTO",
            "SG AUTO",
            "US AUTO",
            "Other Area",
            "ALL NODE",
        ];
        let test_url = "https://www.gstatic.com/generate_204";
        let timeout = 5000;
        let mut tasks = Vec::new();
        let arc_mihomo = Arc::new(mihomo);
        for _ in 0..=10 {
            for proxy in proxies.into_iter() {
                let mihomo_ = Arc::clone(&arc_mihomo);
                tasks.push(tokio::spawn(async move {
                    match mihomo_.delay_proxy_by_name(proxy, test_url, timeout).await {
                        Ok(delay) => {
                            println!("{proxy}: {delay:?}");
                        }
                        Err(e) => {
                            println!("{proxy}: error: {e}");
                        }
                    }
                }));
            }
        }
        for task in tasks.into_iter() {
            task.await.unwrap();
        }
        println!("---------------------------------");
        Ok(())
    }

    #[tokio::test]
    async fn test_delay_group() -> Result<()> {
        let mihomo = mihomo();
        let delay = mihomo
            .delay_group("PROXY", "https://www.gstatic.com/generate_204", 5000)
            .await?;
        println!("{delay:?}");
        Ok(())
    }

    #[tokio::test]
    async fn test_upgrade_geo() -> Result<()> {
        let mihomo = mihomo();
        if let Err(e) = mihomo.upgrade_geo().await {
            println!("upgrade core failed, {e:?}")
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_upgrade_core() -> Result<()> {
        let mihomo = mihomo();
        if let Err(e) = mihomo.upgrade_core().await {
            println!("upgrade core failed, {e:?}")
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_restart() -> Result<()> {
        let mihomo = mihomo();
        mihomo.restart().await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_ws_traffic() -> Result<()> {
        let mihomo = mihomo();
        let on_message = Channel::new(|message| {
            match message {
                InvokeResponseBody::Json(msg) => {
                    if let Ok(WebSocketMessage::Text(data)) = serde_json::from_str(&msg) {
                        if data.starts_with("websocket error") {
                            println!("received error: {data}");
                        } else {
                            let data = serde_json::from_str::<Traffic>(&data).unwrap();
                            println!("{data:?}");
                        }
                    }
                }
                InvokeResponseBody::Raw(raw) => {
                    println!("{}", String::from_utf8(raw).unwrap());
                }
            }
            Ok(())
        });
        let websocket_id = mihomo.ws_traffic(on_message.clone()).await?;
        println!("WebSocket ID: {websocket_id}");
        tokio::time::sleep(Duration::from_millis(5000)).await;
        mihomo.disconnect(websocket_id, Some(0)).await?;
        for i in 0..10 {
            println!("check connection exist {i}");
            if !mihomo.get_connection(websocket_id).await {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        Ok(())
    }
}

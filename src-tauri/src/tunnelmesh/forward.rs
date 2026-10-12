//! Local SOCKS5 and HTTP proxy listeners backed by TunnelMesh streams.

use super::{pool::TunnelMeshSessionPool, session::StreamRequest};
use anyhow::{Context as _, Result, bail};
use base64::Engine as _;
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tokio::{
    io::{AsyncReadExt as _, AsyncWriteExt as _},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;

const MAX_HTTP_HEADER: usize = 64 * 1024;

#[derive(Clone)]
pub struct ForwardConfig {
    pub listen: SocketAddr,
    pub agent_id: String,
    pub allow_remote: bool,
    pub auth: ForwardAuth,
}

#[derive(Clone, Default)]
pub enum ForwardAuth {
    #[default]
    None,
    Password {
        username: String,
        password: String,
    },
    Basic {
        username: String,
        password: String,
    },
}

impl std::fmt::Debug for ForwardAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::None => "None",
            Self::Password { .. } => "Password(<redacted>)",
            Self::Basic { .. } => "Basic(<redacted>)",
        })
    }
}

impl std::fmt::Debug for ForwardConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ForwardConfig")
            .field("listen", &self.listen)
            .field("agent_id", &self.agent_id)
            .field("allow_remote", &self.allow_remote)
            .field("auth", &self.auth)
            .finish()
    }
}

#[derive(Debug)]
pub enum ListenerSafetyError {
    RemoteDisabled,
    SocksAuthRequired,
    HttpAuthRequired,
}

impl std::fmt::Display for ListenerSafetyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RemoteDisabled => f.write_str("non-loopback TunnelMesh listeners require allow_remote"),
            Self::SocksAuthRequired => f.write_str("non-loopback SOCKS5 listeners require password authentication"),
            Self::HttpAuthRequired => f.write_str("non-loopback HTTP listeners require basic authentication"),
        }
    }
}

impl std::error::Error for ListenerSafetyError {}

pub const fn validate_listener(config: &ForwardConfig, http: bool) -> std::result::Result<(), ListenerSafetyError> {
    if is_loopback(config.listen.ip()) {
        return Ok(());
    }
    if !config.allow_remote {
        return Err(ListenerSafetyError::RemoteDisabled);
    }
    match (&config.auth, http) {
        (ForwardAuth::Basic { .. }, true) | (ForwardAuth::Password { .. }, false) => Ok(()),
        (_, true) => Err(ListenerSafetyError::HttpAuthRequired),
        (_, false) => Err(ListenerSafetyError::SocksAuthRequired),
    }
}

#[derive(Clone)]
pub struct Socks5Forward {
    config: ForwardConfig,
    pool: TunnelMeshSessionPool,
}

#[derive(Clone)]
pub struct HttpProxyForward {
    config: ForwardConfig,
    pool: TunnelMeshSessionPool,
}

pub struct ForwardHandle {
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<Result<()>>,
    pub listen: SocketAddr,
}

impl ForwardHandle {
    pub async fn shutdown(self) -> Result<()> {
        self.cancel.cancel();
        self.task.await.context("forwarder task failed")??;
        Ok(())
    }
}

impl Socks5Forward {
    pub fn new(config: ForwardConfig, pool: TunnelMeshSessionPool) -> Result<Self> {
        validate_listener(&config, false)?;
        if config.agent_id.trim().is_empty() {
            bail!("TunnelMesh agent_id is required");
        }
        Ok(Self { config, pool })
    }

    pub async fn bind(self) -> Result<ForwardHandle> {
        let listener = TcpListener::bind(self.config.listen)
            .await
            .with_context(|| format!("failed to bind TunnelMesh SOCKS5 listener on {}", self.config.listen))?;
        let listen = listener.local_addr()?;
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    result = listener.accept() => result,
                    _ = task_cancel.cancelled() => break,
                };
                let (socket, _) = accepted.context("TunnelMesh SOCKS5 accept failed")?;
                let pool = self.pool.clone();
                let config = self.config.clone();
                let child = task_cancel.child_token();
                tokio::spawn(async move {
                    let _ = handle_socks(socket, config, pool, child).await;
                });
            }
            Ok(())
        });
        Ok(ForwardHandle { cancel, task, listen })
    }
}

impl HttpProxyForward {
    pub fn new(config: ForwardConfig, pool: TunnelMeshSessionPool) -> Result<Self> {
        validate_listener(&config, true)?;
        if config.agent_id.trim().is_empty() {
            bail!("TunnelMesh agent_id is required");
        }
        Ok(Self { config, pool })
    }

    pub async fn bind(self) -> Result<ForwardHandle> {
        let listener = TcpListener::bind(self.config.listen)
            .await
            .with_context(|| format!("failed to bind TunnelMesh HTTP listener on {}", self.config.listen))?;
        let listen = listener.local_addr()?;
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            loop {
                let accepted = tokio::select! {
                    result = listener.accept() => result,
                    _ = task_cancel.cancelled() => break,
                };
                let (socket, _) = accepted.context("TunnelMesh HTTP accept failed")?;
                let pool = self.pool.clone();
                let config = self.config.clone();
                let child = task_cancel.child_token();
                tokio::spawn(async move {
                    let _ = handle_http(socket, config, pool, child).await;
                });
            }
            Ok(())
        });
        Ok(ForwardHandle { cancel, task, listen })
    }
}

async fn handle_socks(
    mut socket: TcpStream,
    config: ForwardConfig,
    pool: TunnelMeshSessionPool,
    cancel: CancellationToken,
) -> Result<()> {
    let mut head = [0u8; 2];
    socket.read_exact(&mut head).await?;
    if head[0] != 5 {
        bail!("unsupported SOCKS version");
    }
    let mut methods = vec![0u8; head[1] as usize];
    socket.read_exact(&mut methods).await?;
    let method = match &config.auth {
        ForwardAuth::Password { .. } if methods.contains(&2) => 2,
        _ if methods.contains(&0) => 0,
        _ => 0xff,
    };
    socket.write_all(&[5, method]).await?;
    if method == 0xff {
        bail!("SOCKS5 authentication rejected");
    }
    if method == 2 {
        let mut auth_head = [0u8; 2];
        socket.read_exact(&mut auth_head).await?;
        let mut user = vec![0u8; auth_head[1] as usize];
        socket.read_exact(&mut user).await?;
        let mut pass_len = [0u8; 1];
        socket.read_exact(&mut pass_len).await?;
        let mut pass = vec![0u8; pass_len[0] as usize];
        socket.read_exact(&mut pass).await?;
        let valid = matches!(config.auth, ForwardAuth::Password { ref username, ref password } if user == username.as_bytes() && pass == password.as_bytes());
        socket.write_all(&[1, if valid { 0 } else { 1 }]).await?;
        if !valid {
            bail!("SOCKS5 authentication rejected");
        }
    }
    let mut request = [0u8; 4];
    socket.read_exact(&mut request).await?;
    if request[0] != 5 || request[1] != 1 {
        send_socks_reply(&mut socket, 7, None).await?;
        bail!("SOCKS5 command is not CONNECT");
    }
    let (host, port) = read_socks_target(&mut socket, request[3]).await?;
    let stream = pool
        .open_stream(
            &config.agent_id,
            StreamRequest::tcp(&config.agent_id, host, port),
            &cancel,
        )
        .await?;
    socket.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    bridge(socket, stream, cancel).await
}

async fn read_socks_target(socket: &mut TcpStream, atyp: u8) -> Result<(String, u16)> {
    let host = match atyp {
        1 => {
            let mut bytes = [0u8; 4];
            socket.read_exact(&mut bytes).await?;
            IpAddr::from(bytes).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await?;
            let mut bytes = vec![0u8; len[0] as usize];
            socket.read_exact(&mut bytes).await?;
            String::from_utf8(bytes).context("invalid SOCKS5 domain")?
        }
        4 => {
            let mut bytes = [0u8; 16];
            socket.read_exact(&mut bytes).await?;
            IpAddr::from(bytes).to_string()
        }
        _ => bail!("unsupported SOCKS5 address type"),
    };
    let mut port = [0u8; 2];
    socket.read_exact(&mut port).await?;
    Ok((host, u16::from_be_bytes(port)))
}

async fn send_socks_reply(socket: &mut TcpStream, code: u8, addr: Option<SocketAddr>) -> Result<()> {
    let mut response = vec![5, code, 0, 1, 0, 0, 0, 0, 0, 0];
    if let Some(SocketAddr::V4(v4)) = addr {
        response[4..8].copy_from_slice(&v4.ip().octets());
        response[8..10].copy_from_slice(&v4.port().to_be_bytes());
    }
    socket.write_all(&response).await?;
    Ok(())
}

async fn handle_http(
    mut socket: TcpStream,
    config: ForwardConfig,
    pool: TunnelMeshSessionPool,
    cancel: CancellationToken,
) -> Result<()> {
    let request = read_http_head(&mut socket).await?;
    let (head, body) = parse_http_head(&request)?;
    if let ForwardAuth::Basic {
        ref username,
        ref password,
    } = config.auth
    {
        let expected = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"))
        );
        let supplied = head
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("proxy-authorization"))
            .map(|(_, v)| v.as_str());
        if supplied != Some(expected.as_str()) {
            socket.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\nContent-Length: 0\r\n\r\n").await?;
            bail!("HTTP proxy authentication rejected");
        }
    }
    let method = body.method.to_ascii_uppercase();
    let (host, port, protocol, outbound) = if method == "CONNECT" {
        let (host, port) = split_host_port(&body.target, 443)?;
        (host, port, "tcp", Vec::new())
    } else {
        if body.target.starts_with('*') || body.target.starts_with('/') {
            bail!("HTTP request target is not proxy absolute-form");
        }
        let url = reqwest::Url::parse(&body.target).context("invalid HTTP proxy target")?;
        let host = url.host_str().context("HTTP target has no host")?.to_owned();
        let port = url.port_or_known_default().context("HTTP target has no port")?;
        let mut path = if url.path().is_empty() {
            "/".to_owned()
        } else {
            url.path().to_owned()
        };
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        let mut encoded = format!("{} {} HTTP/1.1\r\n", body.method, path).into_bytes();
        for (key, value) in &head {
            if !key.eq_ignore_ascii_case("proxy-authorization") && !key.eq_ignore_ascii_case("proxy-connection") {
                encoded.extend_from_slice(format!("{key}: {value}\r\n").as_bytes());
            }
        }
        encoded.extend_from_slice(b"\r\n");
        encoded.extend_from_slice(&body.rest);
        (host, port, "http", encoded)
    };
    let stream = pool
        .open_stream(
            &config.agent_id,
            StreamRequest::new(&config.agent_id, protocol, host, port),
            &cancel,
        )
        .await?;
    if method == "CONNECT" {
        socket.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await?;
    }
    if !outbound.is_empty() {
        stream.send_data(&outbound, &cancel).await?;
    }
    bridge(socket, stream, cancel).await
}

struct HttpRequest {
    method: String,
    target: String,
    rest: Vec<u8>,
}

async fn read_http_head(socket: &mut TcpStream) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    loop {
        let mut byte = [0u8; 1];
        socket.read_exact(&mut byte).await?;
        data.push(byte[0]);
        if data.len() > MAX_HTTP_HEADER {
            bail!("HTTP proxy headers exceed limit");
        }
        if data.ends_with(b"\r\n\r\n") {
            return Ok(data);
        }
    }
}

fn parse_http_head(data: &[u8]) -> Result<(Vec<(String, String)>, HttpRequest)> {
    let text = std::str::from_utf8(data).context("HTTP headers are not UTF-8")?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().context("missing HTTP request line")?;
    let mut fields = request_line.splitn(3, ' ');
    let method = fields.next().context("missing HTTP method")?.to_owned();
    let target = fields.next().context("missing HTTP target")?.to_owned();
    if fields.next().is_none() {
        bail!("missing HTTP version");
    }
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (key, value) = line.split_once(':').context("invalid HTTP header")?;
        headers.push((key.trim().to_owned(), value.trim().to_owned()));
    }
    Ok((
        headers,
        HttpRequest {
            method,
            target,
            rest: Vec::new(),
        },
    ))
}

fn split_host_port(raw: &str, default_port: u16) -> Result<(String, u16)> {
    let raw = raw.trim();
    if raw.is_empty() {
        bail!("HTTP CONNECT target is empty");
    }
    if raw.starts_with('[') {
        let (host, port) = raw
            .strip_prefix('[')
            .and_then(|value| value.split_once("]:"))
            .context("invalid bracketed HTTP CONNECT target")?;
        let port = port.parse::<u16>().context("invalid HTTP CONNECT port")?;
        if port == 0 {
            bail!("HTTP CONNECT port must be positive");
        }
        return Ok((host.to_owned(), port));
    }
    if raw.matches(':').count() > 1 {
        bail!("IPv6 HTTP CONNECT targets must be bracketed");
    }
    if let Some((host, port)) = raw.rsplit_once(':') {
        if host.is_empty() {
            bail!("HTTP CONNECT host is empty");
        }
        let port = port.parse::<u16>().context("invalid HTTP CONNECT port")?;
        if port == 0 {
            bail!("HTTP CONNECT port must be positive");
        }
        return Ok((host.to_owned(), port));
    }
    Ok((raw.to_owned(), default_port))
}

async fn bridge(local: TcpStream, stream: super::session::TunnelMeshStream, cancel: CancellationToken) -> Result<()> {
    let stream = Arc::new(stream);
    let child = cancel.child_token();
    let send_stream = Arc::clone(&stream);
    let send_cancel = child.clone();
    let (mut send_local, mut receive_local) = local.into_split();
    let send = tokio::spawn(async move {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let read = tokio::select! { result = send_local.read(&mut buffer) => result?, _ = send_cancel.cancelled() => return Ok::<_, anyhow::Error>(()) };
            if read == 0 {
                send_stream
                    .half_close()
                    .await
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
                return Ok(());
            }
            send_stream
                .send_data(&buffer[..read], &send_cancel)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
    });
    let receive = async {
        while let Some(data) = stream
            .receive_data(&child)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            receive_local.write_all(&data).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    tokio::select! { result = send => { child.cancel(); result??; }, result = receive => { child.cancel(); result?; }, _ = cancel.cancelled() => { child.cancel(); } }
    let _ = stream.reset().await;
    Ok(())
}

const fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    fn config(listen: SocketAddr, auth: ForwardAuth, allow_remote: bool) -> ForwardConfig {
        ForwardConfig {
            listen,
            agent_id: "agent-a".into(),
            allow_remote,
            auth,
        }
    }

    #[test]
    fn loopback_listener_does_not_require_auth() {
        let config = config("127.0.0.1:0".parse().unwrap(), ForwardAuth::None, false);
        assert!(validate_listener(&config, false).is_ok());
        assert!(validate_listener(&config, true).is_ok());
    }

    #[test]
    fn remote_listener_requires_matching_auth() {
        let address = "0.0.0.0:1080".parse().unwrap();
        assert!(matches!(
            validate_listener(&config(address, ForwardAuth::None, true), false),
            Err(ListenerSafetyError::SocksAuthRequired)
        ));
        assert!(matches!(
            validate_listener(&config(address, ForwardAuth::None, true), true),
            Err(ListenerSafetyError::HttpAuthRequired)
        ));
        assert!(
            validate_listener(
                &config(
                    address,
                    ForwardAuth::Password {
                        username: "u".into(),
                        password: "p".into()
                    },
                    true
                ),
                false
            )
            .is_ok()
        );
        assert!(
            validate_listener(
                &config(
                    address,
                    ForwardAuth::Basic {
                        username: "u".into(),
                        password: "p".into()
                    },
                    true
                ),
                true
            )
            .is_ok()
        );
    }

    #[test]
    fn parses_absolute_http_request() {
        let (headers, request) =
            parse_http_head(b"GET http://example.com/a?q=1 HTTP/1.1\r\nHost: example.com\r\n\r\n").unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(request.target, "http://example.com/a?q=1");
        assert_eq!(headers[0], ("Host".to_owned(), "example.com".to_owned()));
    }

    #[test]
    fn splits_ipv6_and_default_ports() {
        assert_eq!(split_host_port("[::1]:8443", 443).unwrap(), ("::1".into(), 8443));
        assert_eq!(
            split_host_port("example.com", 443).unwrap(),
            ("example.com".into(), 443)
        );
    }
}

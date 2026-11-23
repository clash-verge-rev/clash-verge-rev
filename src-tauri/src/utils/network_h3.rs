use std::{
    fmt,
    io::{self, IoSliceMut, Read as _},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, ready},
    time::Duration,
};

use anyhow::{Context as _, Result, anyhow, bail};
use bytes::Buf as _;
use clash_verge_logging::{Type, logging};
use flate2::read::GzDecoder;
use hickory_resolver::{
    Resolver, TokioResolver,
    proto::rr::{
        RData, Record, RecordType,
        rdata::svcb::{SvcParamKey, SvcParamValue},
    },
};
use http::{
    HeaderMap, HeaderValue, Request, StatusCode,
    header::{ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING, LOCATION, USER_AGENT},
};
use quinn::{
    AsyncUdpSocket, ClientConfig, Endpoint, EndpointConfig, TokioRuntime, TransportConfig, UdpPoller,
    crypto::rustls::QuicClientConfig,
    udp::{RecvMeta, Transmit},
};
use rustls::{
    DigitallySignedStruct, SignatureScheme,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
};
use rustls_platform_verifier::BuilderVerifierExt as _;
use sysproxy::Sysproxy;
use tauri::Url;
use tokio::{
    io::{AsyncReadExt as _, AsyncWriteExt as _},
    net::{TcpStream, UdpSocket},
    time::timeout,
};

use crate::config::{Config, MixedPort};

use super::network::{HttpResponse, NetworkManager, ProxyType, TlsRootMode, build_webpki_rooted_tls_config};

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_HTTPS_ALIAS_HOPS: usize = 8;
const DNS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(1);
const DIRECT_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(2);
const PROXY_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
const SOCKS_RECV_BUF_SIZE: usize = 65_536;

#[derive(Debug, Clone, PartialEq, Eq)]
struct H3Endpoint {
    target: String,
    port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProxyAuth {
    username: String,
    password: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SocksProxyConfig {
    host: String,
    port: u16,
    auth: Option<ProxyAuth>,
}

#[derive(Debug)]
struct H3RequestConfig {
    url: Url,
    headers: HeaderMap,
    proxy: Option<SocksProxyConfig>,
    timeout: Duration,
    accept_invalid_certs: bool,
}

/// Attempts to download a subscription profile over HTTP/3 if the host advertises `alpn=h3`
/// via DNS `HTTPS` (TYPE65) records.
///
/// Returns `Ok(Some(response))` when an HTTP/3 response is received (including non-2xx statuses),
/// or `Ok(None)` when the endpoint does not advertise HTTP/3 or HTTP/3 transport fails so the
/// caller can fall back to TCP.
pub(super) async fn try_get_profile(
    url: &str,
    proxy_type: ProxyType,
    timeout_secs: Option<u64>,
    user_agent: Option<&str>,
    accept_invalid_certs: bool,
) -> Option<HttpResponse> {
    let config = build_request_config(url, proxy_type, timeout_secs, user_agent, accept_invalid_certs)
        .await
        .ok()??;

    let resolver = match Resolver::builder_tokio().and_then(|builder| builder.build()) {
        Ok(resolver) => resolver,
        Err(err) => {
            logging!(debug, Type::Network, "HTTP/3 DNS resolver init failed: {err:#}");
            return None;
        }
    };

    let endpoint = discover_h3_endpoint(&resolver, &config.url, DNS_DISCOVERY_TIMEOUT).await?;

    let result = fetch_with_tls_fallback(&config, &resolver, &endpoint).await;
    match result {
        Ok(response) => Some(response),
        Err(err) => {
            logging!(
                debug,
                Type::Network,
                "HTTP/3 profile download failed, falling back to TCP: {err:#}"
            );
            None
        }
    }
}

async fn build_request_config(
    raw_url: &str,
    proxy_type: ProxyType,
    timeout_secs: Option<u64>,
    user_agent: Option<&str>,
    accept_invalid_certs: bool,
) -> Result<Option<H3RequestConfig>> {
    let mut parsed = Url::parse(raw_url)?;
    if parsed.scheme() != "https" {
        return Ok(None);
    }

    let Some(host) = parsed.host_str() else {
        return Ok(None);
    };
    if host.is_empty() || host.parse::<IpAddr>().is_ok() {
        return Ok(None);
    }

    let mut headers = HeaderMap::new();
    if let Some(auth_header) = super::network::extract_basic_auth_header(&parsed)? {
        headers.insert(AUTHORIZATION, auth_header);
    }
    parsed.set_username("").ok();
    parsed.set_password(None).ok();

    let ua = user_agent.map_or_else(
        || format!("clash-verge/v{}", env!("CARGO_PKG_VERSION")),
        std::string::String::from,
    );
    headers.insert(USER_AGENT, HeaderValue::from_str(&ua)?);
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip"));

    let proxy = resolve_socks_proxy(proxy_type).await;
    let total_timeout = Duration::from_secs(timeout_secs.unwrap_or(10).clamp(2, 10));

    Ok(Some(H3RequestConfig {
        url: parsed,
        headers,
        proxy,
        timeout: total_timeout,
        accept_invalid_certs,
    }))
}

async fn resolve_socks_proxy(proxy_type: ProxyType) -> Option<SocksProxyConfig> {
    match proxy_type {
        ProxyType::None => None,
        ProxyType::Localhost => {
            let port = MixedPort::desired().await;
            let auth = clash_proxy_auth().await;
            Some(SocksProxyConfig {
                host: "127.0.0.1".to_string(),
                port,
                auth,
            })
        }
        ProxyType::System => {
            let Ok(sys @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() else {
                return None;
            };
            if sys.host.is_empty() || sys.port == 0 {
                return None;
            }
            let is_local_mixed = is_loopback_host(&sys.host) && sys.port == MixedPort::desired().await;
            let auth = if is_local_mixed { clash_proxy_auth().await } else { None };
            Some(SocksProxyConfig {
                host: sys.host,
                port: sys.port,
                auth,
            })
        }
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

async fn clash_proxy_auth() -> Option<ProxyAuth> {
    let clash = Config::clash().await.latest_arc();
    let entries = clash.0.get("authentication")?.as_sequence()?;
    entries.iter().filter_map(|val| val.as_str()).find_map(parse_proxy_auth)
}

fn parse_proxy_auth(entry: &str) -> Option<ProxyAuth> {
    let (username, password) = entry.split_once(':')?;
    if username.is_empty() {
        return None;
    }
    Some(ProxyAuth {
        username: username.to_string(),
        password: password.to_string(),
    })
}

async fn discover_h3_endpoint(resolver: &TokioResolver, url: &Url, lookup_timeout: Duration) -> Option<H3Endpoint> {
    let host = url.host_str()?;
    let default_port = url.port_or_known_default().unwrap_or(443);
    let initial_owner = https_query_name(host, default_port);

    let result = timeout(lookup_timeout, async {
        let mut current = initial_owner;
        for _ in 0..MAX_HTTPS_ALIAS_HOPS {
            let Ok(lookup) = resolver.lookup(current.as_str(), RecordType::HTTPS).await else {
                return None;
            };
            match select_h3_from_records(lookup.answers(), &current, host, default_port) {
                HttpsSelection::Alias(next) => current = next,
                HttpsSelection::Endpoint(endpoint) => return Some(endpoint),
                HttpsSelection::None => return None,
            }
        }
        None
    })
    .await;

    result.ok().flatten()
}

fn https_query_name(host: &str, port: u16) -> String {
    let fqdn = ensure_fqdn(host);
    if port == 443 {
        fqdn
    } else {
        format!("_{port}._https.{fqdn}")
    }
}

fn ensure_fqdn(name: &str) -> String {
    if name.ends_with('.') {
        name.to_string()
    } else {
        format!("{name}.")
    }
}

#[derive(Debug, PartialEq, Eq)]
enum HttpsSelection {
    Alias(String),
    Endpoint(H3Endpoint),
    None,
}

fn select_h3_from_records(records: &[Record], owner: &str, origin_host: &str, origin_port: u16) -> HttpsSelection {
    let mut current_owner = ensure_fqdn(owner);

    for _ in 0..MAX_HTTPS_ALIAS_HOPS {
        match select_single_hop(records, &current_owner, origin_host, origin_port) {
            HttpsSelection::Alias(next) => {
                if has_owner_record(records, &next) {
                    current_owner = next;
                } else {
                    return HttpsSelection::Alias(next);
                }
            }
            other => return other,
        }
    }

    HttpsSelection::None
}

fn has_owner_record(records: &[Record], owner: &str) -> bool {
    records.iter().any(|rec| {
        ensure_fqdn(&rec.name.to_string()).eq_ignore_ascii_case(owner)
            && matches!(rec.data, RData::CNAME(_) | RData::HTTPS(_))
    })
}

fn select_single_hop(records: &[Record], owner: &str, origin_host: &str, origin_port: u16) -> HttpsSelection {
    let mut best_priority = u16::MAX;
    let mut best: Option<H3Endpoint> = None;

    for record in records {
        if !ensure_fqdn(&record.name.to_string()).eq_ignore_ascii_case(owner) {
            continue;
        }

        match &record.data {
            RData::CNAME(cname) => {
                return HttpsSelection::Alias(ensure_fqdn(&cname.0.to_string()));
            }
            RData::HTTPS(https) => {
                if https.svc_priority == 0 {
                    if https.target_name.is_root() {
                        return HttpsSelection::None;
                    }
                    return HttpsSelection::Alias(ensure_fqdn(&https.target_name.to_string()));
                }

                if https.svc_priority >= best_priority {
                    continue;
                }

                let Some(port) = extract_h3_port(&https.svc_params, origin_port) else {
                    continue;
                };

                let target = resolve_svcb_target(&https.target_name.to_string(), owner, origin_host, origin_port);
                if target.is_empty() {
                    continue;
                }

                best_priority = https.svc_priority;
                best = Some(H3Endpoint { target, port });
            }
            _ => {}
        }
    }

    best.map_or(HttpsSelection::None, HttpsSelection::Endpoint)
}

fn resolve_svcb_target(target_name: &str, owner: &str, origin_host: &str, origin_port: u16) -> String {
    if target_name != "." {
        return target_name.trim_end_matches('.').to_string();
    }

    let origin_fqdn = ensure_fqdn(origin_host);
    let prefixed = format!("_{origin_port}._https.{origin_fqdn}");
    if owner.eq_ignore_ascii_case(&origin_fqdn) || owner.eq_ignore_ascii_case(&prefixed) {
        origin_host.to_string()
    } else {
        owner.trim_end_matches('.').to_string()
    }
}

fn extract_h3_port(params: &[(SvcParamKey, SvcParamValue)], default_port: u16) -> Option<u16> {
    let mut has_h3 = false;
    let mut port = default_port;

    for (_, value) in params {
        match value {
            SvcParamValue::Alpn(alpn) => {
                if alpn.0.iter().any(|proto| proto == "h3") {
                    has_h3 = true;
                }
            }
            SvcParamValue::Port(custom_port) => {
                if *custom_port == 0 {
                    return None;
                }
                port = *custom_port;
            }
            SvcParamValue::Mandatory(mandatory) => {
                let all_supported = mandatory
                    .0
                    .iter()
                    .all(|key| matches!(key, SvcParamKey::Alpn | SvcParamKey::Port | SvcParamKey::NoDefaultAlpn));
                if !all_supported {
                    return None;
                }
            }
            _ => {}
        }
    }

    has_h3.then_some(port)
}

async fn fetch_with_tls_fallback(
    config: &H3RequestConfig,
    resolver: &TokioResolver,
    endpoint: &H3Endpoint,
) -> Result<HttpResponse> {
    match fetch_once_with_tls(config, resolver, endpoint, TlsRootMode::PlatformVerifier).await {
        Ok(resp) => Ok(resp),
        Err(err) if !config.accept_invalid_certs && NetworkManager::should_retry_with_static_webpki_roots(&err) => {
            fetch_once_with_tls(config, resolver, endpoint, TlsRootMode::StaticWebpkiRoots).await
        }
        Err(err) => Err(err),
    }
}

async fn fetch_once_with_tls(
    config: &H3RequestConfig,
    resolver: &TokioResolver,
    endpoint: &H3Endpoint,
    tls_root_mode: TlsRootMode,
) -> Result<HttpResponse> {
    let tls_config = build_h3_tls_config(tls_root_mode, config.accept_invalid_certs)?;
    let quic_client = build_quinn_client_config(tls_config, config.proxy.is_some())?;

    timeout(config.timeout, async {
        let (endpoint_handle, conn) = connect_quic(config, resolver, endpoint, quic_client).await?;
        let response = send_h3_get_with_redirects(conn, &config.url, &config.headers).await;
        endpoint_handle.close(0u32.into(), b"done");
        response
    })
    .await
    .context("HTTP/3 request timed out")?
}

fn build_h3_tls_config(tls_root_mode: TlsRootMode, accept_invalid_certs: bool) -> Result<rustls::ClientConfig> {
    let mut config = if accept_invalid_certs {
        rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_safe_default_protocol_versions()?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SkipServerVerification))
            .with_no_client_auth()
    } else {
        match tls_root_mode {
            TlsRootMode::PlatformVerifier => {
                rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                    .with_safe_default_protocol_versions()?
                    .with_platform_verifier()?
                    .with_no_client_auth()
            }
            TlsRootMode::StaticWebpkiRoots => build_webpki_rooted_tls_config()?,
        }
    };

    config.alpn_protocols = vec![b"h3".to_vec()];
    Ok(config)
}

fn build_quinn_client_config(tls_config: rustls::ClientConfig, disable_pmtud: bool) -> Result<ClientConfig> {
    let quic_tls = QuicClientConfig::try_from(tls_config)?;
    let mut client = ClientConfig::new(Arc::new(quic_tls));

    if disable_pmtud {
        let mut transport = TransportConfig::default();
        transport.mtu_discovery_config(None);
        client.transport_config(Arc::new(transport));
    }

    Ok(client)
}

async fn connect_quic(
    config: &H3RequestConfig,
    resolver: &TokioResolver,
    h3_endpoint: &H3Endpoint,
    client_config: ClientConfig,
) -> Result<(Endpoint, quinn::Connection)> {
    let sni_host = config.url.host_str().ok_or_else(|| anyhow!("missing URL host"))?;

    if let Some(proxy) = &config.proxy {
        return connect_quic_via_socks5(proxy, h3_endpoint, sni_host, client_config).await;
    }

    let lookup = resolver
        .lookup_ip(h3_endpoint.target.as_str())
        .await
        .context("failed to resolve HTTP/3 target IP")?;
    let mut last_err = anyhow!("no IP addresses returned for HTTP/3 target");

    for ip in lookup.iter() {
        let remote = SocketAddr::new(ip, h3_endpoint.port);
        match connect_quic_direct(remote, sni_host, client_config.clone()).await {
            Ok(pair) => return Ok(pair),
            Err(err) => last_err = err,
        }
    }

    Err(last_err)
}

async fn connect_quic_direct(
    remote: SocketAddr,
    sni_host: &str,
    client_config: ClientConfig,
) -> Result<(Endpoint, quinn::Connection)> {
    let bind_addr: SocketAddr = match remote {
        SocketAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
        SocketAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
    };
    let endpoint = Endpoint::client(bind_addr)?;
    let connecting = endpoint.connect_with(client_config, remote, sni_host)?;
    let conn = timeout(DIRECT_HANDSHAKE_TIMEOUT, connecting)
        .await
        .context("HTTP/3 direct QUIC handshake timed out")??;
    Ok((endpoint, conn))
}

async fn connect_quic_via_socks5(
    proxy: &SocksProxyConfig,
    h3_endpoint: &H3Endpoint,
    sni_host: &str,
    client_config: ClientConfig,
) -> Result<(Endpoint, quinn::Connection)> {
    let (socks_socket, virtual_remote) = timeout(
        PROXY_HANDSHAKE_TIMEOUT,
        SocksUdpSocket::connect(proxy, &h3_endpoint.target, h3_endpoint.port),
    )
    .await
    .context("SOCKS5 UDP associate timed out")??;

    let endpoint = Endpoint::new_with_abstract_socket(
        EndpointConfig::default(),
        None,
        Arc::new(socks_socket),
        Arc::new(TokioRuntime),
    )?;

    let connecting = endpoint.connect_with(client_config, virtual_remote, sni_host)?;
    let conn = timeout(PROXY_HANDSHAKE_TIMEOUT, connecting)
        .await
        .context("HTTP/3 QUIC handshake via SOCKS5 timed out")??;
    Ok((endpoint, conn))
}

async fn send_h3_get_with_redirects(
    conn: quinn::Connection,
    initial_url: &Url,
    headers: &HeaderMap,
) -> Result<HttpResponse> {
    let (mut driver, mut send_request) = h3::client::new(h3_quinn::Connection::new(conn)).await?;
    let driver_task = tokio::spawn(async move {
        let _ = std::future::poll_fn(|cx| driver.poll_close(cx)).await;
    });

    let result = async {
        let mut current_url = initial_url.clone();
        for hop in 0..=MAX_REDIRECTS {
            let (status, resp_headers, raw_body) = execute_h3_get(&mut send_request, &current_url, headers).await?;

            if is_redirect_status(status)
                && let Some(location) = resp_headers.get(LOCATION).and_then(|v| v.to_str().ok())
            {
                if hop == MAX_REDIRECTS {
                    bail!("HTTP/3 subscription exceeded redirect limit");
                }
                let next_url = current_url.join(location)?;
                if !is_same_origin(initial_url, &next_url) {
                    bail!("HTTP/3 subscription redirected outside its origin");
                }
                current_url = next_url;
                continue;
            }

            let decoded = maybe_decompress_body(&resp_headers, raw_body)?;
            let text = String::from_utf8(decoded).context("HTTP/3 response body is not valid UTF-8")?;
            return Ok(HttpResponse::new(status, resp_headers, text.into()));
        }

        bail!("HTTP/3 subscription redirect loop")
    }
    .await;

    driver_task.abort();
    result
}

async fn execute_h3_get(
    send_request: &mut h3::client::SendRequest<h3_quinn::OpenStreams, bytes::Bytes>,
    url: &Url,
    headers: &HeaderMap,
) -> Result<(StatusCode, HeaderMap, Vec<u8>)> {
    let mut req_builder = Request::get(url.as_str());
    for (name, value) in headers {
        req_builder = req_builder.header(name, value);
    }
    let request = req_builder.body(())?;

    let mut stream = send_request.send_request(request).await?;
    stream.finish().await?;

    let response = stream.recv_response().await?;
    let status = response.status();
    let resp_headers = response.headers().clone();

    let mut body = Vec::new();
    while let Some(mut chunk) = stream.recv_data().await? {
        if body.len() + chunk.remaining() > MAX_RESPONSE_BYTES {
            bail!("HTTP/3 response exceeded {MAX_RESPONSE_BYTES} byte limit");
        }
        while chunk.has_remaining() {
            let slice = chunk.chunk();
            body.extend_from_slice(slice);
            let len = slice.len();
            chunk.advance(len);
        }
    }

    Ok((status, resp_headers, body))
}

fn is_redirect_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn is_same_origin(origin: &Url, next: &Url) -> bool {
    origin.scheme() == next.scheme()
        && origin
            .host_str()
            .zip(next.host_str())
            .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
        && origin.port_or_known_default() == next.port_or_known_default()
}

fn maybe_decompress_body(headers: &HeaderMap, raw: Vec<u8>) -> Result<Vec<u8>> {
    let is_gzip = headers
        .get(CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|enc| enc.trim().eq_ignore_ascii_case("gzip"));
    if !is_gzip {
        return Ok(raw);
    }

    let mut decoder = GzDecoder::new(raw.as_slice()).take((MAX_RESPONSE_BYTES + 1) as u64);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out)?;
    if out.len() > MAX_RESPONSE_BYTES {
        bail!("decompressed HTTP/3 response exceeded {MAX_RESPONSE_BYTES} byte limit");
    }
    Ok(out)
}

struct SocksUdpSocket {
    udp: UdpSocket,
    _control: TcpStream,
    target_header: Vec<u8>,
    virtual_remote: SocketAddr,
    recv_buf: Mutex<Vec<u8>>,
}

impl fmt::Debug for SocksUdpSocket {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SocksUdpSocket")
            .field("virtual_remote", &self.virtual_remote)
            .finish_non_exhaustive()
    }
}

impl SocksUdpSocket {
    async fn connect(proxy: &SocksProxyConfig, target_host: &str, target_port: u16) -> Result<(Self, SocketAddr)> {
        let host_bytes = target_host.as_bytes();
        if host_bytes.is_empty() || host_bytes.len() > u8::MAX as usize {
            bail!("invalid SOCKS5 target domain length");
        }

        let mut control = TcpStream::connect((proxy.host.as_str(), proxy.port))
            .await
            .context("failed to connect to SOCKS5 proxy")?;
        let peer_ip = control.peer_addr()?.ip();

        socks5_authenticate(&mut control, proxy.auth.as_ref()).await?;
        let relay_addr = socks5_udp_associate(&mut control, peer_ip).await?;

        let bind_addr: SocketAddr = match relay_addr {
            SocketAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0),
            SocketAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 0),
        };
        let udp = UdpSocket::bind(bind_addr).await?;
        udp.connect(relay_addr).await?;

        let virtual_remote = match relay_addr {
            SocketAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)), target_port),
            SocketAddr::V6(_) => {
                SocketAddr::new(IpAddr::V6(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 1)), target_port)
            }
        };

        // RFC 1928 UDP request header using ATYP=DOMAINNAME so Mihomo matches domain rules.
        let mut target_header = Vec::with_capacity(7 + host_bytes.len());
        target_header.extend_from_slice(&[0x00, 0x00, 0x00, 0x03, host_bytes.len() as u8]);
        target_header.extend_from_slice(host_bytes);
        target_header.extend_from_slice(&target_port.to_be_bytes());

        Ok((
            Self {
                udp,
                _control: control,
                target_header,
                virtual_remote,
                recv_buf: Mutex::new(vec![0u8; SOCKS_RECV_BUF_SIZE]),
            },
            virtual_remote,
        ))
    }
}

async fn socks5_authenticate(stream: &mut TcpStream, auth: Option<&ProxyAuth>) -> Result<()> {
    if auth.is_some() {
        stream.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
    } else {
        stream.write_all(&[0x05, 0x01, 0x00]).await?;
    }

    let mut greeting = [0u8; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        bail!("proxy is not SOCKS5");
    }

    match greeting[1] {
        0x00 => Ok(()),
        0x02 => {
            let Some(creds) = auth else {
                bail!("SOCKS5 proxy requires authentication");
            };
            let user = creds.username.as_bytes();
            let pass = creds.password.as_bytes();
            if user.len() > u8::MAX as usize || pass.len() > u8::MAX as usize {
                bail!("SOCKS5 credentials exceed maximum length");
            }
            let mut req = Vec::with_capacity(3 + user.len() + pass.len());
            req.push(0x01);
            req.push(user.len() as u8);
            req.extend_from_slice(user);
            req.push(pass.len() as u8);
            req.extend_from_slice(pass);
            stream.write_all(&req).await?;

            let mut resp = [0u8; 2];
            stream.read_exact(&mut resp).await?;
            if resp[0] != 0x01 || resp[1] != 0x00 {
                bail!("SOCKS5 authentication failed");
            }
            Ok(())
        }
        method => bail!("unsupported SOCKS5 auth method: 0x{method:02x}"),
    }
}

async fn socks5_udp_associate(stream: &mut TcpStream, peer_ip: IpAddr) -> Result<SocketAddr> {
    stream.write_all(&[0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await?;

    let mut header = [0u8; 4];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 || header[1] != 0x00 {
        bail!("SOCKS5 UDP associate rejected with status 0x{:02x}", header[1]);
    }

    let ip = match header[3] {
        0x01 => {
            let mut octets = [0u8; 4];
            stream.read_exact(&mut octets).await?;
            IpAddr::V4(Ipv4Addr::from(octets))
        }
        0x04 => {
            let mut octets = [0u8; 16];
            stream.read_exact(&mut octets).await?;
            IpAddr::V6(Ipv6Addr::from(octets))
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut domain = vec![0u8; usize::from(len[0])];
            stream.read_exact(&mut domain).await?;
            let domain = std::str::from_utf8(&domain).context("invalid SOCKS5 BND.ADDR domain")?;
            domain.parse::<IpAddr>().unwrap_or(peer_ip)
        }
        atyp => bail!("unsupported SOCKS5 BND.ADDR type: 0x{atyp:02x}"),
    };

    let mut port_bytes = [0u8; 2];
    stream.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);
    if port == 0 {
        bail!("SOCKS5 UDP associate returned port 0");
    }

    let relay_ip = if ip.is_unspecified() { peer_ip } else { ip };
    Ok(SocketAddr::new(relay_ip, port))
}

fn parse_socks5_udp_payload(packet: &[u8]) -> Option<&[u8]> {
    if packet.len() < 4 || packet[2] != 0x00 {
        return None;
    }

    let header_len = match packet[3] {
        0x01 => 4 + 4 + 2,
        0x04 => 4 + 16 + 2,
        0x03 => {
            let domain_len = usize::from(*packet.get(4)?);
            4 + 1 + domain_len + 2
        }
        _ => return None,
    };

    packet.get(header_len..)
}

#[derive(Debug)]
struct SocksUdpPoller(Arc<SocksUdpSocket>);

impl UdpPoller for SocksUdpPoller {
    fn poll_writable(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.0.udp.poll_send_ready(cx)
    }
}

impl AsyncUdpSocket for SocksUdpSocket {
    fn create_io_poller(self: Arc<Self>) -> Pin<Box<dyn UdpPoller>> {
        Box::pin(SocksUdpPoller(self))
    }

    fn try_send(&self, transmit: &Transmit<'_>) -> io::Result<()> {
        let mut packet = Vec::with_capacity(self.target_header.len() + transmit.contents.len());
        packet.extend_from_slice(&self.target_header);
        packet.extend_from_slice(transmit.contents);
        self.udp.try_send(&packet).map(|_| ())
    }

    fn poll_recv(
        &self,
        cx: &mut Context<'_>,
        bufs: &mut [IoSliceMut<'_>],
        meta: &mut [RecvMeta],
    ) -> Poll<io::Result<usize>> {
        if bufs.is_empty() || meta.is_empty() {
            return Poll::Ready(Ok(0));
        }

        loop {
            ready!(self.udp.poll_recv_ready(cx))?;
            let mut scratch = self
                .recv_buf
                .lock()
                .map_err(|_| io::Error::other("SOCKS5 UDP receive buffer lock poisoned"))?;
            let read_len = match self.udp.try_recv(&mut scratch) {
                Ok(n) => n,
                Err(err) if err.kind() == io::ErrorKind::WouldBlock => continue,
                Err(err) => return Poll::Ready(Err(err)),
            };

            let Some(payload) = parse_socks5_udp_payload(&scratch[..read_len]) else {
                continue;
            };
            let payload_len = payload.len();
            if payload_len > bufs[0].len() {
                continue;
            }

            bufs[0][..payload_len].copy_from_slice(payload);
            drop(scratch);
            meta[0] = RecvMeta {
                addr: self.virtual_remote,
                len: payload_len,
                stride: payload_len,
                ecn: None,
                dst_ip: None,
            };
            return Poll::Ready(Ok(1));
        }
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.udp.local_addr()
    }
}

#[derive(Debug)]
struct SkipServerVerification;

impl ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use flate2::{Compression, write::GzEncoder};
    use hickory_resolver::proto::rr::{
        Name,
        rdata::{
            CNAME, HTTPS, SVCB,
            svcb::{Alpn, Mandatory},
        },
    };
    use std::{
        io::Write as _,
        str::FromStr as _,
        sync::atomic::{AtomicBool, Ordering},
    };
    use tokio::net::TcpListener;

    fn make_https_record(
        owner: &str,
        priority: u16,
        target: &str,
        params: Vec<(SvcParamKey, SvcParamValue)>,
    ) -> Record {
        Record::from_rdata(
            Name::from_str(owner).unwrap_or_else(|_| Name::root()),
            60,
            RData::HTTPS(HTTPS(SVCB::new(
                priority,
                Name::from_str(target).unwrap_or_else(|_| Name::root()),
                params,
            ))),
        )
    }

    #[test]
    fn selects_h3_only_endpoint() {
        let records = vec![make_https_record(
            "subscription.example.",
            1,
            ".",
            vec![
                (SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into()]))),
                (SvcParamKey::NoDefaultAlpn, SvcParamValue::NoDefaultAlpn),
            ],
        )];

        let got = select_h3_from_records(&records, "subscription.example.", "subscription.example", 443);
        assert_eq!(
            got,
            HttpsSelection::Endpoint(H3Endpoint {
                target: "subscription.example".into(),
                port: 443,
            })
        );
    }

    #[test]
    fn selects_lowest_priority_alternative_endpoint_and_port() {
        let owner = "_8443._https.subscription.example.";
        let records = vec![
            make_https_record(
                owner,
                2,
                ".",
                vec![(SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into()])))],
            ),
            make_https_record(
                owner,
                1,
                "edge.example.",
                vec![
                    (
                        SvcParamKey::Alpn,
                        SvcParamValue::Alpn(Alpn(vec!["h2".into(), "h3".into()])),
                    ),
                    (SvcParamKey::Port, SvcParamValue::Port(9443)),
                ],
            ),
        ];

        let got = select_h3_from_records(&records, owner, "subscription.example", 8443);
        assert_eq!(
            got,
            HttpsSelection::Endpoint(H3Endpoint {
                target: "edge.example".into(),
                port: 9443,
            })
        );
    }

    #[test]
    fn follows_alias_and_cname_and_rejects_unsupported_mandatory() {
        let alias = vec![make_https_record("subscription.example.", 0, "edge.example.", vec![])];
        assert_eq!(
            select_h3_from_records(&alias, "subscription.example.", "subscription.example", 443),
            HttpsSelection::Alias("edge.example.".into())
        );

        let cname_chain = vec![
            Record::from_rdata(
                Name::from_str("subscription.example.").unwrap_or_else(|_| Name::root()),
                60,
                RData::CNAME(CNAME(Name::from_str("edge.example.").unwrap_or_else(|_| Name::root()))),
            ),
            make_https_record(
                "edge.example.",
                1,
                ".",
                vec![(SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into()])))],
            ),
        ];
        assert_eq!(
            select_h3_from_records(&cname_chain, "subscription.example.", "subscription.example", 443),
            HttpsSelection::Endpoint(H3Endpoint {
                target: "edge.example".into(),
                port: 443,
            })
        );

        let unusable = vec![
            make_https_record(
                "subscription.example.",
                1,
                ".",
                vec![(SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h2".into()])))],
            ),
            make_https_record(
                "subscription.example.",
                2,
                ".",
                vec![
                    (SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into()]))),
                    (
                        SvcParamKey::Mandatory,
                        SvcParamValue::Mandatory(Mandatory(vec![SvcParamKey::Key(65400)])),
                    ),
                ],
            ),
            make_https_record(
                "unrelated.example.",
                1,
                ".",
                vec![(SvcParamKey::Alpn, SvcParamValue::Alpn(Alpn(vec!["h3".into()])))],
            ),
        ];
        assert_eq!(
            select_h3_from_records(&unusable, "subscription.example.", "subscription.example", 443),
            HttpsSelection::None
        );
    }

    #[test]
    fn parses_proxy_auth_entries() {
        assert_eq!(
            parse_proxy_auth("profile:sec:ret"),
            Some(ProxyAuth {
                username: "profile".into(),
                password: "sec:ret".into(),
            })
        );
        assert_eq!(parse_proxy_auth(":secret"), None);
        assert_eq!(parse_proxy_auth("invalid"), None);
    }

    fn build_test_server_and_client_tls(domain: &str) -> Result<(quinn::ServerConfig, rustls::ClientConfig)> {
        let certified = rcgen::generate_simple_self_signed(vec![domain.to_string()])?;
        let cert_der = certified.cert.der().clone();
        let key_der = rustls::pki_types::PrivateKeyDer::try_from(certified.signing_key.serialize_der())
            .map_err(|err| anyhow!("failed to build test private key: {err}"))?;

        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut server_tls = rustls::ServerConfig::builder_with_provider(Arc::clone(&provider))
            .with_safe_default_protocol_versions()?
            .with_no_client_auth()
            .with_single_cert(vec![cert_der.clone()], key_der)?;
        server_tls.alpn_protocols = vec![b"h3".to_vec()];
        let server_quic = quinn::crypto::rustls::QuicServerConfig::try_from(server_tls)?;
        let server_cfg = quinn::ServerConfig::with_crypto(Arc::new(server_quic));

        let mut roots = rustls::RootCertStore::empty();
        roots.add(cert_der)?;
        let mut client_tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()?
            .with_root_certificates(roots)
            .with_no_client_auth();
        client_tls.alpn_protocols = vec![b"h3".to_vec()];

        Ok((server_cfg, client_tls))
    }

    fn spawn_test_h3_server(server_cfg: quinn::ServerConfig) -> Result<(SocketAddr, tokio::task::JoinHandle<()>)> {
        let endpoint = Endpoint::server(server_cfg, SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        let addr = endpoint.local_addr()?;

        let handle = tokio::spawn(async move {
            while let Some(incoming) = endpoint.accept().await {
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else {
                        return;
                    };
                    let Ok(mut h3_conn) = h3::server::Connection::new(h3_quinn::Connection::new(conn)).await else {
                        return;
                    };

                    while let Ok(Some(resolver)) = h3_conn.accept().await {
                        let Ok((req, mut stream)) = resolver.resolve_request().await else {
                            break;
                        };

                        if req.uri().path() == "/redirect" {
                            if let Ok(resp) = http::Response::builder()
                                .status(StatusCode::FOUND)
                                .header(LOCATION, "/config?version=1")
                                .body(())
                            {
                                let _ = stream.send_response(resp).await;
                                let _ = stream.finish().await;
                            }
                            continue;
                        }

                        let ok_auth = req.headers().get(AUTHORIZATION).and_then(|v| v.to_str().ok())
                            == Some("Basic dGVzdDp0ZXN0");
                        let ok_path = req.uri().path_and_query().map(|pq| pq.as_str()) == Some("/config?version=1");

                        if !ok_auth || !ok_path {
                            if let Ok(resp) = http::Response::builder().status(StatusCode::BAD_REQUEST).body(()) {
                                let _ = stream.send_response(resp).await;
                                let _ = stream.finish().await;
                            }
                            continue;
                        }

                        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
                        let _ = encoder.write_all(b"proxies: []\n");
                        let compressed = encoder.finish().unwrap_or_default();

                        if let Ok(resp) = http::Response::builder()
                            .status(StatusCode::OK)
                            .header("subscription-userinfo", "total=42")
                            .header(CONTENT_ENCODING, "gzip")
                            .body(())
                        {
                            let _ = stream.send_response(resp).await;
                            let _ = stream.send_data(Bytes::from(compressed)).await;
                            let _ = stream.finish().await;
                        }
                    }
                });
            }
        });

        Ok((addr, handle))
    }

    async fn spawn_test_socks5_udp_proxy(
        expected_user: &'static str,
        expected_pass: &'static str,
        expected_domain: &'static str,
        backend_addr: SocketAddr,
        domain_matched: Arc<AtomicBool>,
    ) -> Result<(SocketAddr, tokio::task::JoinHandle<()>)> {
        let tcp_listener = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_addr = tcp_listener.local_addr()?;

        let handle = tokio::spawn(async move {
            while let Ok((mut stream, _)) = tcp_listener.accept().await {
                let domain_matched = Arc::clone(&domain_matched);
                tokio::spawn(async move {
                    let mut greeting = [0u8; 2];
                    if stream.read_exact(&mut greeting).await.is_err() || greeting[0] != 0x05 {
                        return;
                    }
                    let mut methods = vec![0u8; usize::from(greeting[1])];
                    if stream.read_exact(&mut methods).await.is_err() {
                        return;
                    }
                    if !methods.contains(&0x02) {
                        let _ = stream.write_all(&[0x05, 0xFF]).await;
                        return;
                    }
                    let _ = stream.write_all(&[0x05, 0x02]).await;

                    let mut auth_ver = [0u8; 2];
                    if stream.read_exact(&mut auth_ver).await.is_err() || auth_ver[0] != 0x01 {
                        return;
                    }
                    let mut user = vec![0u8; usize::from(auth_ver[1])];
                    if stream.read_exact(&mut user).await.is_err() {
                        return;
                    }
                    let mut pass_len = [0u8; 1];
                    if stream.read_exact(&mut pass_len).await.is_err() {
                        return;
                    }
                    let mut pass = vec![0u8; usize::from(pass_len[0])];
                    if stream.read_exact(&mut pass).await.is_err() {
                        return;
                    }
                    if user != expected_user.as_bytes() || pass != expected_pass.as_bytes() {
                        let _ = stream.write_all(&[0x01, 0x01]).await;
                        return;
                    }
                    let _ = stream.write_all(&[0x01, 0x00]).await;

                    let mut req = [0u8; 10];
                    if stream.read_exact(&mut req).await.is_err() || req[1] != 0x03 {
                        return;
                    }

                    let Ok(relay_udp) = UdpSocket::bind("127.0.0.1:0").await else {
                        return;
                    };
                    let Ok(relay_addr) = relay_udp.local_addr() else {
                        return;
                    };
                    let Ok(backend_udp) = UdpSocket::bind("127.0.0.1:0").await else {
                        return;
                    };
                    if backend_udp.connect(backend_addr).await.is_err() {
                        return;
                    }

                    let mut reply = [0u8; 10];
                    reply[0] = 0x05;
                    reply[3] = 0x01;
                    reply[4..8].copy_from_slice(&Ipv4Addr::LOCALHOST.octets());
                    reply[8..10].copy_from_slice(&relay_addr.port().to_be_bytes());
                    if stream.write_all(&reply).await.is_err() {
                        return;
                    }

                    let mut client_addr: Option<SocketAddr> = None;
                    let mut from_client = vec![0u8; SOCKS_RECV_BUF_SIZE];
                    let mut from_backend = vec![0u8; SOCKS_RECV_BUF_SIZE];
                    let mut ctrl_buf = [0u8; 1];

                    loop {
                        tokio::select! {
                            res = stream.read(&mut ctrl_buf) => {
                                match res {
                                    Ok(0) | Err(_) => break,
                                    Ok(_) => {}
                                }
                            }
                            res = relay_udp.recv_from(&mut from_client) => {
                                let Ok((n, src)) = res else {
                                    break;
                                };
                                client_addr = Some(src);
                                if n < 7 || from_client[2] != 0x00 || from_client[3] != 0x03 {
                                    continue;
                                }
                                let dlen = usize::from(from_client[4]);
                                if n < 7 + dlen {
                                    continue;
                                }
                                let domain = &from_client[5..5 + dlen];
                                let port = u16::from_be_bytes([from_client[5 + dlen], from_client[6 + dlen]]);
                                if domain == expected_domain.as_bytes() && port == backend_addr.port() {
                                    domain_matched.store(true, Ordering::SeqCst);
                                    let _ = backend_udp.send(&from_client[7 + dlen..n]).await;
                                }
                            }
                            res = backend_udp.recv(&mut from_backend) => {
                                let Ok(n) = res else {
                                    break;
                                };
                                let Some(dst) = client_addr else {
                                    continue;
                                };
                                let mut wrapped = Vec::with_capacity(10 + n);
                                wrapped.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
                                wrapped.extend_from_slice(&Ipv4Addr::LOCALHOST.octets());
                                wrapped.extend_from_slice(&backend_addr.port().to_be_bytes());
                                wrapped.extend_from_slice(&from_backend[..n]);
                                let _ = relay_udp.send_to(&wrapped, dst).await;
                            }
                        }
                    }
                });
            }
        });

        Ok((proxy_addr, handle))
    }

    #[tokio::test]
    async fn downloads_profile_over_h3_direct_and_via_authenticated_socks5_udp() -> Result<()> {
        let (server_cfg, client_tls) = build_test_server_and_client_tls("example.com")?;
        let (server_addr, server_task) = spawn_test_h3_server(server_cfg)?;

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Basic dGVzdDp0ZXN0"));
        headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
        let url = Url::parse("https://example.com/redirect")?;

        // Direct HTTP/3 with same-origin redirect + gzip decompression
        let direct_cfg = build_quinn_client_config(client_tls.clone(), false)?;
        let (ep, conn) = connect_quic_direct(server_addr, "example.com", direct_cfg).await?;
        let resp = send_h3_get_with_redirects(conn, &url, &headers).await?;
        ep.close(0u32.into(), b"done");

        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.text(), "proxies: []\n");
        assert_eq!(
            resp.headers()
                .get("subscription-userinfo")
                .and_then(|v| v.to_str().ok()),
            Some("total=42")
        );

        // Authenticated SOCKS5 UDP Associate forwarding domain name
        let domain_matched = Arc::new(AtomicBool::new(false));
        let (proxy_addr, proxy_task) = spawn_test_socks5_udp_proxy(
            "profile",
            "secret",
            "edge.example.com",
            server_addr,
            Arc::clone(&domain_matched),
        )
        .await?;

        let h3_endpoint = H3Endpoint {
            target: "edge.example.com".into(),
            port: server_addr.port(),
        };
        let good_proxy = SocksProxyConfig {
            host: "127.0.0.1".into(),
            port: proxy_addr.port(),
            auth: Some(ProxyAuth {
                username: "profile".into(),
                password: "secret".into(),
            }),
        };
        let proxied_cfg = build_quinn_client_config(client_tls.clone(), true)?;
        let (ep, conn) = connect_quic_via_socks5(&good_proxy, &h3_endpoint, "example.com", proxied_cfg).await?;
        let resp = send_h3_get_with_redirects(conn, &url, &headers).await?;
        ep.close(0u32.into(), b"done");

        assert!(domain_matched.load(Ordering::SeqCst));
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(resp.text(), "proxies: []\n");

        // Rejected proxy auth must fail without attempting direct connection
        let bad_proxy = SocksProxyConfig {
            host: "127.0.0.1".into(),
            port: proxy_addr.port(),
            auth: Some(ProxyAuth {
                username: "profile".into(),
                password: "wrong-password".into(),
            }),
        };
        let bad_cfg = build_quinn_client_config(client_tls, true)?;
        assert!(
            connect_quic_via_socks5(&bad_proxy, &h3_endpoint, "example.com", bad_cfg)
                .await
                .is_err()
        );

        proxy_task.abort();
        server_task.abort();
        Ok(())
    }
}

use crate::{config::Config, process::AsyncHandler, utils::dirs};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use futures::StreamExt as _;
use parking_lot::Mutex;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use serde_yaml_ng::{Mapping, Value};
use sha2::{Digest as _, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

/// 单次连接(建连+握手)超时
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
/// 并发握手数
const FETCH_CONCURRENCY: usize = 8;

/// 会话内指纹缓存:proxy name -> 证书指纹。纯内存,不落盘,进程退出即清。
static SESSION_PINS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug)]
struct PinTarget {
    name: String,
    server: String,
    port: u16,
    sni: String,
}

#[derive(Debug)]
struct AcceptAnyServerCert;

impl ServerCertVerifier for AcceptAnyServerCert {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// 仅这些协议的 TLS 握手才有可钉扎的证书
const TLS_PROXY_TYPES: [&str; 6] = ["vless", "vmess", "trojan", "hysteria2", "anytls", "tuic"];

fn is_tls_proxy(proxy: &Mapping) -> bool {
    if proxy.get("tls").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    let Some(Value::String(ty)) = proxy.get("type") else {
        return false;
    };
    TLS_PROXY_TYPES.contains(&ty.as_str())
}

/// 从节点定义提取钉扎目标;校验不过(找不到、非 TLS 或未关 skip-cert-verify)返回 None。
fn pin_target_of(name: &str, proxy: &Mapping) -> Option<PinTarget> {
    if proxy.get("skip-cert-verify").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    if !is_tls_proxy(proxy) {
        return None;
    }
    let server = proxy.get("server").and_then(Value::as_str)?;
    let port = proxy.get("port").and_then(Value::as_u64)?;
    let port = u16::try_from(port).ok()?;
    let sni = proxy
        .get("servername")
        .and_then(Value::as_str)
        .or_else(|| proxy.get("sni").and_then(Value::as_str))
        .unwrap_or(server);
    Some(PinTarget {
        name: name.into(),
        server: server.into(),
        port,
        sni: sni.into(),
    })
}

async fn fetch_fingerprint(server: &str, port: u16, sni: &str) -> Result<String> {
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyServerCert))
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(config));
    let server_name =
        rustls::pki_types::ServerName::try_from(sni.to_owned()).map_err(|_| anyhow::anyhow!("invalid sni: {sni}"))?;

    let addr = format!("{server}:{port}");
    let stream = tokio::time::timeout(FETCH_TIMEOUT, async {
        let tcp = TcpStream::connect(&addr).await?;
        connector.connect(server_name, tcp).await
    })
    .await
    .map_err(|_| anyhow::anyhow!("connect to {addr} timed out"))??;

    let (_, connection) = stream.get_ref();
    let der = connection
        .peer_certificates()
        .and_then(|certs| certs.first())
        .ok_or_else(|| anyhow::anyhow!("no peer certificate from {addr}"))?;

    let digest = Sha256::digest(der.as_ref());
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

/// 为选中的节点补齐会话指纹:只对会话内还没钉过的名字发起握手,校验不过或握手失败的跳过。
/// 返回本次新钉的节点数。
async fn ensure_pin_for_nodes(nodes: Vec<String>) -> Result<usize> {
    if Config::verge().await.latest_arc().enable_cert_pinning != Some(true) {
        return Ok(0);
    }

    let pending: Vec<String> = {
        let pins = SESSION_PINS.lock();
        let mut seen = HashSet::new();
        nodes
            .into_iter()
            .filter(|name| !pins.contains_key(name) && seen.insert(name.clone()))
            .collect()
    };
    if pending.is_empty() {
        return Ok(0);
    }

    // 在当前订阅文件里定位这些节点的定义
    let profiles = Config::profiles().await;
    let Some(uid) = profiles.latest_arc().current.clone() else {
        return Ok(0);
    };
    let Some(file) = profiles
        .latest_arc()
        .get_item(&uid)
        .ok()
        .and_then(|item| item.file.clone())
    else {
        return Ok(0);
    };

    let path = dirs::app_profiles_dir()?.join(file.as_str());
    let content = tokio::fs::read_to_string(&path).await?;
    let Ok(config) = serde_yaml_ng::from_str::<Mapping>(&content) else {
        return Ok(0);
    };

    let proxies: Vec<&Mapping> = config
        .get("proxies")
        .and_then(Value::as_sequence)
        .map(|seq| seq.iter().filter_map(Value::as_mapping).collect())
        .unwrap_or_default();
    let targets: Vec<PinTarget> = pending
        .iter()
        .filter_map(|name| {
            proxies
                .iter()
                .find(|proxy| proxy.get("name").and_then(Value::as_str) == Some(name.as_str()))
                .and_then(|proxy| pin_target_of(name, proxy))
        })
        .collect();
    if targets.is_empty() {
        return Ok(0);
    }

    let results = futures::stream::iter(targets.into_iter().map(|target| async move {
        let fp = fetch_fingerprint(&target.server, target.port, &target.sni).await;
        (target, fp)
    }))
    .buffer_unordered(FETCH_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    let mut pinned = 0usize;
    for (target, result) in results {
        match result {
            Ok(fp) => {
                SESSION_PINS.lock().insert(target.name, fp);
                pinned += 1;
            }
            Err(err) => logging!(
                warn,
                Type::Config,
                "cert-pin: fetch {} ({}:{}) failed: {err:#}",
                target.name,
                target.server,
                target.port
            ),
        }
    }
    Ok(pinned)
}

/// fire-and-forget:为选中节点补齐会话指纹,有新钉时刷新一次配置。任何错误只记日志不上抛。
pub fn ensure_pins_async(nodes: Vec<String>) {
    AsyncHandler::spawn(move || async move {
        if let Err(err) = ensure_pins_inner(nodes).await {
            logging!(warn, Type::Config, "cert-pin: {err:#}");
        }
    });
}

async fn ensure_pins_inner(nodes: Vec<String>) -> Result<()> {
    let pinned = ensure_pin_for_nodes(nodes).await?;
    if pinned == 0 {
        return Ok(());
    }
    crate::feat::enhance_profiles().await?;
    logging!(
        info,
        Type::Config,
        "cert-pin: pinned {pinned} new node(s), config refreshed"
    );
    Ok(())
}

/// enhance 末端注入:开关开启且会话已钉扎时,为节点写入 fingerprint 并关闭 skip-cert-verify。
/// 只读会话内存,零网络 I/O。
pub fn apply_cert_pins(mut config: Mapping, enabled: bool) -> Mapping {
    if !enabled {
        return config;
    }
    let pins = SESSION_PINS.lock();
    if pins.is_empty() {
        return config;
    }
    let Some(Value::Sequence(proxies)) = config.get_mut("proxies") else {
        return config;
    };
    for proxy in proxies.iter_mut() {
        let Some(proxy) = proxy.as_mapping_mut() else {
            continue;
        };
        if proxy.get("skip-cert-verify").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        if !is_tls_proxy(proxy) {
            continue;
        }
        let Some(name) = proxy.get("name").and_then(Value::as_str) else {
            continue;
        };
        if let Some(fp) = pins.get(name) {
            proxy.insert("fingerprint".into(), Value::from(fp.as_str()));
            proxy.insert("skip-cert-verify".into(), Value::from(false));
        }
    }
    config
}

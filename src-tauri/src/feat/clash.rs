use crate::core::notify::NoticeStatus;
use crate::core::notify::{Refresh, announce};
use crate::{
    config::{Config, MixedPort},
    core::{CoreManager, handle, tray},
    feat::clean_async,
    process::AsyncHandler,
    utils,
};
use bytes::BytesMut;
use clash_verge_logging::{Type, logging};
use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::sync::{Arc, LazyLock};
use tauri_plugin_mihomo::models::{Proxies, ProxyType};

#[allow(clippy::expect_used)]
pub(crate) static TLS_CONFIG: LazyLock<Arc<rustls::ClientConfig>> = LazyLock::new(|| {
    let root_store = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("Failed to set TLS versions")
        .with_root_certificates(root_store)
        .with_no_client_auth();
    Arc::new(config)
});

pub async fn restart_clash_core() {
    match CoreManager::global().restart_core().await {
        Ok(_) => {
            announce(Refresh::Clash);
        }
        Err(err) => {
            handle::Handle::notice(NoticeStatus::SetConfigError, format!("{err:#}"));
            logging!(error, Type::Core, "restart core failed: {err:#}");
        }
    }
}

pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    handle::Handle::global().set_is_exiting();

    Config::apply_all_and_save_file().await;

    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if !cleanup_result.core_stopped {
        handle::Handle::global().clear_is_exiting();
        // A failed stop may still have marked the core stopped, and exit cleanup skipped the DNS restore.
        // A core that kept running keeps its DNS, whatever an unapplied config draft says.
        #[cfg(target_os = "macos")]
        {
            let manager = CoreManager::global();
            let _lifecycle = manager.lifecycle_lock.lock().await;
            if matches!(
                *manager.get_running_mode(),
                crate::core::manager::RunningMode::NotRunning
            ) {
                crate::utils::resolve::dns::sync_public_dns().await;
            }
        }
        handle::Handle::notice(
            NoticeStatus::AppRestartCoreStopFailed,
            cleanup_result.stop_error.unwrap_or_default(),
        );
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}

fn after_change_clash_mode() {
    AsyncHandler::spawn(move || async {
        if let Err(err) = handle::Handle::mihomo().close_all_connections().await {
            logging!(
                error,
                Type::Core,
                "Failed to close all connections after changing clash mode: {err}"
            );
        }
    });
}

/// Propagates mihomo PATCH failures so the frontend can roll back its optimistic mode.
pub async fn change_clash_mode(mode: String) -> Result<(), String> {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode.as_str()));
    let json_value = serde_json::json!({
        "mode": mode
    });
    if let Err(err) = handle::Handle::mihomo().patch_base_config(&json_value).await {
        logging!(error, Type::Core, "change clash mode failed: {err}");
        return Err(err.to_string().into());
    }

    let clash = Config::clash().await;
    clash.edit_draft(|d| d.patch_config(&mapping));
    clash.apply();

    let clash_data = clash.data_arc();
    if clash_data.save_config().await.is_ok() {
        announce(Refresh::Clash);
        tray::Tray::global().update_menu_and_icon().await;
    }

    let is_auto_close_connection = Config::verge().await.data_arc().auto_close_connection.unwrap_or(false);
    if is_auto_close_connection {
        after_change_clash_mode();
    }

    Ok(())
}

/// Test delay to a URL through proxy.
/// HTTPS: measures TLS handshake time. HTTP: measures HEAD round-trip time.
#[tracing::instrument(skip_all, level = "trace", fields(url = %url))]
pub async fn test_delay(url: String) -> anyhow::Result<u32> {
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpStream;
    use tokio::time::Instant;

    let parsed = tauri::Url::parse(&url)?;
    let is_https = parsed.scheme() == "https";
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid URL: no host"))?
        .to_string();
    let port = parsed.port().unwrap_or(if is_https { 443 } else { 80 });

    let verge = Config::verge().await.latest_arc();
    let proxy_enabled = verge.enable_system_proxy.unwrap_or(false) || verge.enable_tun_mode.unwrap_or(false);
    let proxy_port = if proxy_enabled {
        Some(MixedPort::desired().await)
    } else {
        None
    };

    tokio::time::timeout(Duration::from_secs(10), async {
        let start = Instant::now();
        let mut buf = BytesMut::with_capacity(1024);

        if is_https {
            let stream = match proxy_port {
                Some(pp) => {
                    let mut s = TcpStream::connect(format!("127.0.0.1:{pp}")).await?;
                    s.write_all(format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n").as_bytes())
                        .await?;
                    s.read_buf(&mut buf).await?;
                    if !buf.windows(3).any(|w| w == b"200") {
                        return Err(anyhow::anyhow!("Proxy CONNECT failed"));
                    }
                    s
                }
                None => TcpStream::connect(format!("{host}:{port}")).await?,
            };
            let connector = tokio_rustls::TlsConnector::from(Arc::clone(&TLS_CONFIG));
            let server_name = rustls::pki_types::ServerName::try_from(host.as_str())
                .map_err(|_| anyhow::anyhow!("Invalid DNS name: {host}"))?
                .to_owned();
            connector.connect(server_name, stream).await?;
        } else {
            let (mut stream, req) = match proxy_port {
                Some(pp) => (
                    TcpStream::connect(format!("127.0.0.1:{pp}")).await?,
                    format!("HEAD {url} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
                ),
                None => (
                    TcpStream::connect(format!("{host}:{port}")).await?,
                    format!("HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
                ),
            };
            stream.write_all(req.as_bytes()).await?;
            let _ = stream.read(&mut buf).await?;
        }

        Ok((start.elapsed().as_millis() as u32).max(1))
    })
    .await
    .unwrap_or(Ok(10000u32))
}

/// Result of a download-throughput measurement.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestResult {
    /// Average throughput across the measurement window, in bytes per second.
    pub speed: u64,
    /// Best sampled throughput after warm-up, in bytes per second.
    pub peak: u64,
    /// Total bytes received during the measurement window.
    pub downloaded: u64,
    /// Measurement duration in milliseconds.
    pub elapsed_ms: u64,
    /// Number of concurrent connections used for the measurement.
    pub connections: u32,
}

/// Measure download throughput.
///
/// When `proxy_name` is provided, the node is temporarily selected in its first
/// selector group so the download is routed through that specific node; the
/// previous selection is restored afterwards. When omitted, the download goes
/// through the current mixed-port (system proxy / TUN) route.
///
/// The connection is streamed for at most `timeout_ms` (clamped to 1s..30s) or
/// until `max_bytes` is reached, after which throughput is bytes / time.
#[tracing::instrument(skip_all, level = "trace", fields(url = %url, proxy_name = ?proxy_name))]
pub async fn test_speed(url: String, proxy_name: Option<String>, timeout_ms: u64) -> anyhow::Result<SpeedTestResult> {
    use std::time::{Duration, Instant};

    let parsed = tauri::Url::parse(&url)?;
    let is_https = parsed.scheme() == "https";
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid URL: no host"))?
        .to_string();
    let port = parsed.port().unwrap_or(if is_https { 443 } else { 80 });
    let path = parsed.path();
    let query = parsed.query();
    let path_and_query = match query {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path.to_string(),
    };

    let verge = Config::verge().await.latest_arc();
    let proxy_enabled = verge.enable_system_proxy.unwrap_or(false) || verge.enable_tun_mode.unwrap_or(false);
    let proxy_port = if proxy_enabled {
        Some(MixedPort::desired().await)
    } else {
        None
    };

    // Optionally route through a specific node by selecting it in its group.
    let mut restore: Option<(std::string::String, std::string::String)> = None;
    if let Some(name) = &proxy_name
        && let Some(proxies) = fetch_proxies_for_speed().await
    {
        for (group_name, proxy) in &proxies.proxies {
            if !matches!(proxy.proxy_type, ProxyType::Selector) {
                continue;
            }
            let has_member = proxy
                .all
                .as_ref()
                .is_some_and(|members| members.iter().any(|m| m == name));
            if !has_member {
                continue;
            }
            // Only switch when the node actually differs, so no restore is needed otherwise.
            if let Some(now) = &proxy.now
                && now.as_str() != name.as_str()
            {
                let _ = select_node_for_speed(group_name, name).await;
                restore = Some((group_name.clone(), now.clone()));
            }
            break;
        }
    }

    let budget = Duration::from_millis(timeout_ms.clamp(2000, 30_000));
    let overall = budget + Duration::from_secs(6);

    // A single TCP stream is bounded by the bandwidth-delay product, so it
    // under-reports fast links with high latency. Real speed tests fan out
    // several parallel streams to saturate the pipe.
    const CONNECTIONS: u32 = 4;
    // Ceiling on total traffic per run, so a very fast line cannot burn through
    // hundreds of megabytes in one click.
    const MAX_BYTES: u64 = 100 * 1024 * 1024;
    const SAMPLE_MS: u64 = 200;
    const WARMUP_MS: u64 = 2000;

    let target = SpeedTarget {
        host: host.clone(),
        port,
        is_https,
        path_and_query: path_and_query.clone(),
        url: url.clone(),
        proxy_port,
    };

    let measured = tokio::time::timeout(overall, async move {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

        let start = Instant::now();
        let total = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));

        let mut workers = Vec::with_capacity(CONNECTIONS as usize);
        let failure: Arc<std::sync::Mutex<Option<std::string::String>>> = Arc::new(std::sync::Mutex::new(None));
        for _ in 0..CONNECTIONS {
            let target = target.clone();
            let total = Arc::clone(&total);
            let stop = Arc::clone(&stop);
            let failure = Arc::clone(&failure);
            workers.push(tokio::spawn(async move {
                if let Err(error) = download_worker(target, total, stop).await
                    && let Ok(mut slot) = failure.lock()
                    && slot.is_none()
                {
                    *slot = Some(format!("{error:#}"));
                }
            }));
        }

        let mut peak: u64 = 0;
        let mut last_bytes: u64 = 0;
        let mut last_tick = Duration::ZERO;

        loop {
            tokio::time::sleep(Duration::from_millis(SAMPLE_MS)).await;
            let now_bytes = total.load(Ordering::Relaxed);
            let tick = start.elapsed();
            let delta_t = tick.saturating_sub(last_tick).as_millis() as u64;
            let instant = now_bytes
                .saturating_sub(last_bytes)
                .saturating_mul(1000)
                .checked_div(delta_t)
                .unwrap_or(0);
            if tick.as_millis() as u64 >= WARMUP_MS {
                peak = peak.max(instant);
            }
            last_bytes = now_bytes;
            last_tick = tick;
            if tick >= budget || now_bytes >= MAX_BYTES {
                break;
            }
        }

        let downloaded = total.load(Ordering::Relaxed);
        let elapsed_ms = start.elapsed().as_millis().max(1) as u64;
        stop.store(true, Ordering::Relaxed);
        for worker in workers {
            worker.abort();
        }

        let speed = downloaded.saturating_mul(1000).checked_div(elapsed_ms).unwrap_or(0);
        if downloaded == 0 {
            let detail = failure.lock().ok().and_then(|slot| slot.clone());
            match detail {
                Some(message) => anyhow::bail!("{message}"),
                None => anyhow::bail!("测速未收到任何数据，请检查测速地址或代理状态"),
            }
        }
        Ok::<SpeedTestResult, anyhow::Error>(SpeedTestResult {
            speed,
            peak: peak.max(speed),
            downloaded,
            elapsed_ms,
            connections: CONNECTIONS,
        })
    })
    .await;

    // Always restore the previous node selection, even on timeout/error.
    if let Some((group_name, now)) = &restore {
        let _ = select_node_for_speed(group_name, now).await;
    }

    match measured {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(anyhow::anyhow!("测速超时，请重试")),
    }
}

/// Everything a single download worker needs to open its connection.
#[derive(Clone)]
struct SpeedTarget {
    host: std::string::String,
    port: u16,
    is_https: bool,
    path_and_query: std::string::String,
    // `String` is aliased to `SmartString` in this module.
    url: String,
    proxy_port: Option<u16>,
}

/// One parallel stream. Re-requests the payload whenever a response ends, so
/// the sampler keeps receiving data for the whole window even on fast links.
async fn download_worker(
    target: SpeedTarget,
    total: Arc<std::sync::atomic::AtomicU64>,
    stop: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<()> {
    use std::sync::atomic::Ordering;

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        // A hard error (rejected request, broken TLS) ends this stream; the
        // sampler decides whether the run as a whole produced anything.
        stream_once(&target, &total, &stop).await?;
    }
    Ok(())
}

/// A single request/response cycle: connect, request, verify the status line,
/// then drain the body.
async fn stream_once(
    target: &SpeedTarget,
    total: &std::sync::atomic::AtomicU64,
    stop: &std::sync::atomic::AtomicBool,
) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpStream;

    let SpeedTarget {
        host,
        port,
        is_https,
        path_and_query,
        url,
        proxy_port,
    } = target;

    let mut stream = match proxy_port {
        Some(pp) => TcpStream::connect(format!("127.0.0.1:{pp}")).await?,
        None => TcpStream::connect(format!("{host}:{port}")).await?,
    };

    if *is_https {
        if proxy_port.is_some() {
            stream
                .write_all(format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n").as_bytes())
                .await?;
            let mut head = BytesMut::with_capacity(512);
            loop {
                let n = stream.read_buf(&mut head).await?;
                if n == 0 {
                    anyhow::bail!("proxy closed the connection during CONNECT");
                }
                if head.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if head.len() > 8192 {
                    anyhow::bail!("proxy CONNECT response too large");
                }
            }
            if !head.starts_with(b"HTTP/1.1 200") && !head.starts_with(b"HTTP/1.0 200") {
                anyhow::bail!("proxy CONNECT rejected");
            }
        }
        let connector = tokio_rustls::TlsConnector::from(Arc::clone(&TLS_CONFIG));
        let server_name = rustls::pki_types::ServerName::try_from(host.as_str())
            .map_err(|_| anyhow::anyhow!("Invalid DNS name: {host}"))?
            .to_owned();
        let mut tls = connector.connect(server_name, stream).await?;
        tls.write_all(
            format!(
                "GET {path_and_query} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept-Encoding: identity\r\n\r\n"
            )
            .as_bytes(),
        )
        .await?;
        ensure_success(&mut tls).await?;
        pump_bytes(&mut tls, total, stop).await
    } else {
        let request = if proxy_port.is_some() {
            format!("GET {url} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept-Encoding: identity\r\n\r\n")
        } else {
            format!(
                "GET {path_and_query} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nAccept-Encoding: identity\r\n\r\n"
            )
        };
        stream.write_all(request.as_bytes()).await?;
        ensure_success(&mut stream).await?;
        pump_bytes(&mut stream, total, stop).await
    }
}

/// Read the status line and reject non-2xx responses, so a refused request
/// (e.g. Cloudflare rejecting an oversized `bytes=` value) surfaces as a clear
/// error instead of a silent 0 B/s.
async fn ensure_success<S>(stream: &mut S) -> anyhow::Result<()>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt as _;

    let mut head = BytesMut::with_capacity(1024);
    loop {
        let n = stream.read_buf(&mut head).await?;
        if n == 0 {
            anyhow::bail!("测速地址未返回响应就关闭了连接");
        }
        if head.windows(2).any(|w| w == b"\r\n") {
            break;
        }
        if head.len() > 8192 {
            anyhow::bail!("测速地址响应头过大");
        }
    }

    let first_line = head.as_ref().split(|byte| *byte == b'\n').next().unwrap_or(&[]);
    let status = std::str::from_utf8(first_line)
        .ok()
        .and_then(|text| text.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok());
    match status {
        Some(code) if (200..300).contains(&code) => Ok(()),
        Some(code) => anyhow::bail!("测速地址返回 HTTP {code}，请在设置中更换测速地址"),
        None => anyhow::bail!("无法解析测速地址的响应状态"),
    }
}

/// Drain the response body, accumulating the byte count until stopped.
async fn pump_bytes<S>(
    stream: &mut S,
    total: &std::sync::atomic::AtomicU64,
    stop: &std::sync::atomic::AtomicBool,
) -> anyhow::Result<()>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use std::sync::atomic::Ordering;
    use tokio::io::AsyncReadExt as _;

    let mut buf = BytesMut::with_capacity(128 * 1024);
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let n = stream.read_buf(&mut buf).await?;
        if n == 0 {
            break;
        }
        total.fetch_add(n as u64, Ordering::Relaxed);
        buf.clear();
    }
    Ok(())
}

async fn fetch_proxies_for_speed() -> Option<Proxies> {
    use std::time::Duration;
    tokio::time::timeout(Duration::from_secs(5), async {
        handle::Handle::mihomo().get_proxies().await.ok()
    })
    .await
    .ok()
    .flatten()
}

async fn select_node_for_speed(group_name: &str, node: &str) {
    use std::time::Duration;
    let _ = tokio::time::timeout(Duration::from_secs(5), async {
        handle::Handle::mihomo().select_node_for_group(group_name, node).await
    })
    .await;
}

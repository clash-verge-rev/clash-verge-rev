use crate::{
    config::Config,
    core::{CoreManager, handle, tray},
    feat::clean_async,
    process::AsyncHandler,
    utils,
};
use bytes::BytesMut;
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use serde_yaml_ng::{Mapping, Value};
use smartstring::alias::String;
use std::sync::Arc;

#[allow(clippy::expect_used)]
static TLS_CONFIG: Lazy<Arc<rustls::ClientConfig>> = Lazy::new(|| {
    let root_store = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("Failed to set TLS versions")
        .with_root_certificates(root_store)
        .with_no_client_auth();
    Arc::new(config)
});

/// Restart the Clash core
pub async fn restart_clash_core() {
    match CoreManager::global().restart_core().await {
        Ok(_) => {
            handle::Handle::refresh_clash();
            handle::Handle::notice_message("set_config::ok", "ok");
        }
        Err(err) => {
            handle::Handle::notice_message("set_config::error", format!("{err}"));
            logging!(error, Type::Core, "{err}");
        }
    }
}

/// Restart the application
pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    utils::server::shutdown_embedded_server();
    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result { 0 } else { 1 }
    );

    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}

fn after_change_clash_mode() {
    AsyncHandler::spawn(move || async {
        let mihomo = handle::Handle::mihomo().await;
        match mihomo.get_connections().await {
            Ok(connections) => {
                if let Some(connections_array) = connections.connections {
                    for connection in connections_array {
                        let _ = mihomo.close_connection(&connection.id).await;
                    }
                    drop(mihomo);
                }
            }
            Err(err) => {
                logging!(error, Type::Core, "Failed to get connections: {err}");
            }
        }
    });
}

/// Change Clash mode (rule/global/direct/script)
///
/// mihomo `/configs` PATCH 失败时返回 `Err`，以便命令层把失败上抛给前端。
/// （此前该函数吞掉错误并始终视为成功，导致 UI 误判"切换成功"、看似"切不动"。）
pub async fn change_clash_mode(mode: String) -> Result<(), String> {
    let mut mapping = Mapping::new();
    mapping.insert(Value::from("mode"), Value::from(mode.as_str()));
    // Convert YAML mapping to JSON Value
    let json_value = serde_json::json!({
        "mode": mode
    });
    logging!(debug, Type::Core, "change clash mode to {mode}");
    if let Err(err) = handle::Handle::mihomo().await.patch_base_config(&json_value).await {
        logging!(error, Type::Core, "{err}");
        return Err(err.to_string().into());
    }

    // 更新订阅
    let clash = Config::clash().await;
    clash.edit_draft(|d| d.patch_config(&mapping));
    clash.apply();

    // 分离数据获取和异步调用
    let clash_data = clash.data_arc();
    if clash_data.save_config().await.is_ok() {
        handle::Handle::refresh_clash();
        tray::Tray::global().update_menu_and_icon().await;
    }

    let is_auto_close_connection = Config::verge().await.data_arc().auto_close_connection.unwrap_or(false);
    if is_auto_close_connection {
        after_change_clash_mode();
    }

    Ok(())
}

/// Test delay result with the proxy chain actually used for the request.
///
/// `chains` follows mihomo's convention: exit node first, top-level group last.
/// Empty when the request did not go through mihomo (system proxy & TUN both off)
/// or the connection could not be matched.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestDelayResult {
    pub delay: u32,
    pub chains: Vec<String>,
}

/// Look up the proxy chain of the mihomo connection whose source port matches
/// the given local port. The test request from `test_delay` reaches mihomo via
/// the mixed port, so mihomo records our local source port as `sourcePort`.
/// Matching by port (not host) avoids misattributing a stale same-host connection.
async fn chains_by_source_port(source_port: u16, mixed_port: u16) -> anyhow::Result<Vec<String>> {
    let mihomo = handle::Handle::mihomo().await;
    let conns = mihomo.get_connections().await?;
    drop(mihomo);
    // plugin returns `Vec<std::string::String>` (it doesn't use smartstring);
    // convert into this crate's `SmartString` alias to match the rest of the file.
    //
    // Match on (sourcePort, sourceIP, inboundPort), not sourcePort alone:
    // sourcePort isn't globally unique across TUN/mixed/other inbounds, so under
    // TUN traffic or concurrency a bare port match could surface another connection.
    // Our test reaches mihomo over loopback (sourceIP 127.0.0.1) at the mixed
    // inbound (inboundPort == mixed_port), which uniquely identifies it.
    let chains = conns
        .connections
        .unwrap_or_default()
        .into_iter()
        .find(|c| {
            let m = &c.metadata;
            m.source_port.trim().parse::<u16>().ok() == Some(source_port)
                && m.source_ip == "127.0.0.1"
                && m.inbound_port.trim().parse::<u16>().ok() == Some(mixed_port)
        })
        .map(|c| c.chains.into_iter().map(Into::into).collect())
        .unwrap_or_default();
    Ok(chains)
}

/// Resolve the proxy chain for the test connection. Returns `["DIRECT"]` for
/// direct connections (no source port — request bypassed mihomo). Wrapped in a
/// 1s timeout so a slow /connections lookup never affects the already-measured
/// delay; any failure degrades to an empty/`DIRECT` chain.
async fn chains_for_source_port(source_port: Option<u16>, mixed_port: Option<u16>) -> Vec<String> {
    match (source_port, mixed_port) {
        (Some(src), Some(mixed)) => tokio::time::timeout(
            std::time::Duration::from_millis(1000),
            chains_by_source_port(src, mixed),
        )
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default(),
        _ => vec![String::from("DIRECT")],
    }
}

/// Test delay to a URL through proxy.
/// HTTPS: measures TLS handshake time. HTTP: measures HEAD round-trip time.
pub async fn test_delay(url: String) -> anyhow::Result<TestDelayResult> {
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
        Some(match verge.verge_mixed_port {
            Some(p) => p,
            None => Config::clash().await.data_arc().get_mixed_port(),
        })
    } else {
        None
    };

    tokio::time::timeout(Duration::from_secs(10), async {
        let start = Instant::now();
        let mut buf = BytesMut::with_capacity(1024);
        // Local source port of the connection to mihomo's mixed port. Used to
        // match the exact connection in /connections after the handshake, so the
        // resolved chain cannot be confused with a stale same-host connection.
        // None for direct connections (proxy & TUN off) — those bypass mihomo.
        let mut source_port: Option<u16> = None;

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
                    // Capture before handing `s` to the TLS connector (which moves it).
                    source_port = s.local_addr().ok().map(|a| a.port());
                    s
                }
                None => TcpStream::connect(format!("{host}:{port}")).await?,
            };
            let connector = tokio_rustls::TlsConnector::from(Arc::clone(&TLS_CONFIG));
            let server_name = rustls::pki_types::ServerName::try_from(host.as_str())
                .map_err(|_| anyhow::anyhow!("Invalid DNS name: {host}"))?
                .to_owned();
            // Keep the TLS stream alive until after we query /connections: the
            // connection must still be in mihomo's manager when we look it up.
            let _tls = connector.connect(server_name, stream).await?;

            // frontend treats 0 as timeout
            let delay = (start.elapsed().as_millis() as u32).max(1);
            // Local round-trip to mihomo (unix socket / loopback), only a few ms —
            // negligible vs the 10s timeout, so it won't flip a slow success into a
            // timeout in practice.
            let chains = chains_for_source_port(source_port, proxy_port).await;
            Ok(TestDelayResult { delay, chains })
        } else {
            let (mut stream, req) = match proxy_port {
                Some(pp) => {
                    let s = TcpStream::connect(format!("127.0.0.1:{pp}")).await?;
                    source_port = s.local_addr().ok().map(|a| a.port());
                    (
                        s,
                        format!("HEAD {url} HTTP/1.1\r\nHost: {host}\r\nConnection: keep-alive\r\n\r\n"),
                    )
                }
                None => (
                    TcpStream::connect(format!("{host}:{port}")).await?,
                    format!("HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"),
                ),
            };
            stream.write_all(req.as_bytes()).await?;
            let _ = stream.read(&mut buf).await?;

            // frontend treats 0 as timeout
            let delay = (start.elapsed().as_millis() as u32).max(1);
            // Local round-trip to mihomo (unix socket / loopback), only a few ms —
            // negligible vs the 10s timeout, so it won't flip a slow success into a
            // timeout in practice.
            let chains = chains_for_source_port(source_port, proxy_port).await;
            Ok(TestDelayResult { delay, chains })
        }
    })
    .await
    .unwrap_or(Ok(TestDelayResult {
        delay: 10000,
        chains: vec![],
    }))
}

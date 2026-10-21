use crate::{
    config::{Config, MixedPort},
    core::proxy_control,
    utils::dirs,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        LazyLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

const PROXY_PORT: u16 = 17891;
const ADMIN_PORT: u16 = 17892;
// Each launch owns a generation, preventing a stale monitor from stopping a newer child.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static ACTIVE: AtomicBool = AtomicBool::new(false);
// Serialize start, stop, and monitor recovery; never hold CHILD across an await.
static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CHILD: LazyLock<Mutex<Option<Child>>> = LazyLock::new(|| Mutex::new(None));
// Reuse local connections across batched refreshes and change subscriptions.
static API_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
});

#[derive(Serialize, specta::Type)]
pub struct CaptureStatus {
    running: bool,
    proxy_port: u16,
    admin_url: Option<String>,
}

/// Override only the system-facing route; Mihomo keeps its own upstream listener.
pub(crate) fn proxy_port(normal: u16) -> u16 {
    if ACTIVE.load(Ordering::Acquire) {
        PROXY_PORT
    } else {
        normal
    }
}

fn data_dir() -> Result<PathBuf, String> {
    dirs::app_home_dir()
        .map(|p| p.join("capture"))
        .map_err(|e| e.to_string())
}

async fn status() -> Result<CaptureStatus, String> {
    let running = ACTIVE.load(Ordering::Acquire);
    let admin_url = if running {
        let token = fs::read_to_string(data_dir()?.join("api-token")).map_err(|e| e.to_string())?;
        let mut url = format!("http://127.0.0.1:{ADMIN_PORT}/?token={}", token.trim());
        if let Some(lang) = Config::verge()
            .await
            .latest_arc()
            .language
            .clone()
            .filter(|l| !l.trim().is_empty())
        {
            url.push_str("&lang=");
            url.push_str(lang.trim());
        }
        Some(url)
    } else {
        None
    };
    Ok(CaptureStatus {
        running,
        proxy_port: PROXY_PORT,
        admin_url,
    })
}

fn binary_path() -> Result<PathBuf, String> {
    let name = format!("clash-capture{}", std::env::consts::EXE_SUFFIX);
    let bundled = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name(&name);
    if bundled.is_file() || !cfg!(debug_assertions) {
        return Ok(bundled);
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join(format!(
        "clash-capture-{}{}",
        env!("CAPTURE_TARGET"),
        std::env::consts::EXE_SUFFIX
    )))
}

async fn apply_capture_route() -> Result<(), String> {
    if Config::verge().await.latest_arc().enable_system_proxy.unwrap_or(false) {
        proxy_control::apply().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn stop_process() {
    GENERATION.fetch_add(1, Ordering::AcqRel);
    ACTIVE.store(false, Ordering::Release);
    if let Some(mut child) = CHILD.lock().take() {
        // SIGTERM lets the sidecar drain its bounded persistence queue before exit.
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
            }
            let deadline = std::time::Instant::now() + Duration::from_secs(6);
            while std::time::Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
#[specta::specta]
pub async fn capture_status() -> Result<CaptureStatus, String> {
    status().await
}

/// Attach sidecar authentication here so page API calls need no bearer headers.
#[tauri::command]
#[specta::specta]
pub async fn capture_api(method: String, path: String, body: Option<String>) -> Result<crate::ipc::JsonValue, String> {
    let value = capture_api_value(method, path, body).await?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

async fn capture_api_value(method: String, path: String, body: Option<String>) -> Result<serde_json::Value, String> {
    if !ACTIVE.load(Ordering::Acquire) {
        return Err("Capture module is not running".into());
    }
    let token = fs::read_to_string(data_dir()?.join("api-token")).map_err(|e| e.to_string())?;
    let client = API_CLIENT.as_ref().map_err(|e| e.to_owned())?;
    let request_method = method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|_| format!("Unsupported method {method}"))?;
    let mut request = client
        .request(
            request_method,
            format!("http://127.0.0.1:{ADMIN_PORT}/api/{}", path.trim_start_matches('/')),
        )
        .bearer_auth(token.trim());
    if let Some(body) = body {
        request = request.header("Content-Type", "application/json").body(body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(if text.trim().is_empty() {
            status.to_string()
        } else {
            text
        });
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Keep only the public CA certificate, never the private key stored next to it.
fn extract_certificate(raw: &[u8]) -> Option<Vec<u8>> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let text = String::from_utf8(raw.to_vec()).ok()?;
    let start = text.find(BEGIN)?;
    let end = text.find(END)? + END.len();
    Some(format!("{}\n", text[start..end].trim_end()).into_bytes())
}

/// Export the machine-local CA so the user can trust it and decrypt HTTPS.
/// The path comes from the system save dialog, which grants write permission.
#[tauri::command]
#[specta::specta]
pub async fn capture_ca_export(path: String) -> Result<String, String> {
    const MISSING: &str = "Certificate not generated yet";
    let pem = if ACTIVE.load(Ordering::Acquire) {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;
        // The public certificate is still behind the sidecar's authenticated API boundary.
        let token = fs::read_to_string(data_dir()?.join("api-token")).map_err(|e| e.to_string())?;
        let response = client
            .get(format!("http://127.0.0.1:{ADMIN_PORT}/certificate"))
            .bearer_auth(token.trim())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(response.status().to_string());
        }
        response.bytes().await.map_err(|e| e.to_string())?.to_vec()
    } else {
        let raw = fs::read(data_dir()?.join("ca.pem")).map_err(|_| MISSING.to_string())?;
        extract_certificate(&raw).ok_or_else(|| MISSING.to_string())?
    };
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, pem).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn capture_start() -> Result<CaptureStatus, String> {
    let _lifecycle = LIFECYCLE.lock().await;
    if ACTIVE.load(Ordering::Acquire) {
        return status().await;
    }
    let verge = Config::verge().await.latest_arc();
    if (verge.enable_system_proxy.unwrap_or(false) && verge.proxy_auto_config.unwrap_or(false))
        || verge.enable_tun_mode.unwrap_or(false)
    {
        return Err("Disable TUN and system PAC before starting capture".into());
    }
    let upstream = MixedPort::effective().await;
    if upstream == PROXY_PORT || upstream == ADMIN_PORT {
        return Err("Mihomo and capture ports must be different".into());
    }
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for port in [PROXY_PORT, ADMIN_PORT] {
        std::net::TcpListener::bind(("127.0.0.1", port))
            .map_err(|e| format!("Capture port {port} unavailable: {e}"))?;
    }
    let token_file = dir.join("api-token");
    if token_file.exists() {
        fs::remove_file(&token_file).map_err(|e| e.to_string())?;
    }
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("capture.log"))
        .map_err(|e| e.to_string())?;
    let child = Command::new(binary_path()?)
        .args([
            "--proxy",
            &format!("127.0.0.1:{PROXY_PORT}"),
            "--api",
            &format!("127.0.0.1:{ADMIN_PORT}"),
            "--upstream",
            &format!("http://127.0.0.1:{upstream}"),
            "--data",
        ])
        .arg(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| e.to_string())?;
    *CHILD.lock() = Some(child);
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(500))
        .build()
        .map_err(|e| e.to_string())?;
    // A listening port alone is insufficient: authenticate against this launch before
    // redirecting system traffic, otherwise a failed startup could leave a dead proxy.
    let mut ready = false;
    for _ in 0..40 {
        if let Ok(token) = fs::read_to_string(&token_file) {
            if let Ok(response) = client
                .get(format!("http://127.0.0.1:{ADMIN_PORT}/api/settings"))
                .bearer_auth(token.trim())
                .send()
                .await
            {
                if response.status().is_success() {
                    ready = true;
                    break;
                }
            }
        }
        if CHILD
            .lock()
            .as_mut()
            .and_then(|c| c.try_wait().ok())
            .flatten()
            .is_some()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if !ready {
        stop_process();
        return Err("Capture failed to start; inspect capture/capture.log".into());
    }
    // Proxy application reads ACTIVE. Roll back both child ownership and the route
    // if the OS/helper rejects the requested system-proxy change.
    ACTIVE.store(true, Ordering::Release);
    if let Err(error) = apply_capture_route().await {
        stop_process();
        let _ = apply_capture_route().await;
        return Err(error.to_string());
    }
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let _lifecycle = LIFECYCLE.lock().await;
            if !ACTIVE.load(Ordering::Acquire) || GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            let exited = CHILD
                .lock()
                .as_mut()
                .and_then(|c| c.try_wait().ok())
                .flatten()
                .is_some();
            // The sidecar's upstream is fixed at launch. Restore the normal route when
            // Mihomo moves instead of leaving all system traffic on a stale upstream.
            let port_changed = MixedPort::effective().await != upstream;
            if exited || port_changed {
                if port_changed {
                    log::info!("Mihomo port changed; stopping capture and restoring the system proxy");
                }
                stop_process();
                if let Err(error) = apply_capture_route().await {
                    log::error!("Restore proxy after capture exit: {error}");
                }
                break;
            }
        }
    });
    status().await
}

#[tauri::command]
#[specta::specta]
pub async fn capture_stop() -> Result<CaptureStatus, String> {
    let _lifecycle = LIFECYCLE.lock().await;
    // Restore the route before terminating the proxy process.
    ACTIVE.store(false, Ordering::Release);
    if let Err(error) = apply_capture_route().await {
        ACTIVE.store(true, Ordering::Release);
        return Err(error.to_string());
    }
    stop_process();
    status().await
}

// Rebuild from persisted bytes, not inspector text: JSON formatting or UTF-8 decoding
// would corrupt binary payloads and invalidate signatures embedded in request bodies.
fn replay_request(
    flow: &serde_json::Value,
    query_override: Option<&str>,
    body_override: Option<&str>,
) -> Result<reqwest::Request, String> {
    let body = flow
        .get("request")
        .filter(|v| v.is_object())
        .ok_or("replayIncomplete")?;
    if body["truncated"].as_bool().unwrap_or(false) || !body["complete"].as_bool().unwrap_or(false) {
        return Err("replayIncomplete".into());
    }
    let url = reqwest::Url::parse(flow["url"].as_str().ok_or("replayUnsupported")?).map_err(|_| "replayUnsupported")?;
    let method = reqwest::Method::from_bytes(flow["method"].as_str().ok_or("replayUnsupported")?.as_bytes())
        .map_err(|_| "replayUnsupported")?;
    if !matches!(url.scheme(), "http" | "https") || method == reqwest::Method::CONNECT {
        return Err("replayUnsupported".into());
    }
    let headers: Vec<[String; 2]> = serde_json::from_value(body["headers"].clone()).map_err(|_| "replayUnsupported")?;
    if headers.iter().any(|[name, _]| name.eq_ignore_ascii_case("upgrade")) {
        return Err("replayUnsupported".into());
    }
    let connection_headers: Vec<String> = headers
        .iter()
        .filter(|[name, _]| name.eq_ignore_ascii_case("connection"))
        .flat_map(|[_, value]| value.split(',').map(|s| s.trim().to_ascii_lowercase()))
        .collect();
    let mut request = reqwest::Request::new(method, url);
    for [name, value] in headers {
        let lower = name.to_ascii_lowercase();
        // Framing and connection-specific headers belong to the new connection.
        if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "transfer-encoding"
                | "connection"
                | "proxy-connection"
                | "proxy-authorization"
                | "keep-alive"
                | "te"
                | "trailer"
                | "expect"
        ) || connection_headers.contains(&lower)
        {
            continue;
        }
        request.headers_mut().append(
            reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| "replayUnsupported")?,
            reqwest::header::HeaderValue::from_str(&value).map_err(|_| "replayUnsupported")?,
        );
    }
    let content = body["body"].as_str().ok_or("replayIncomplete")?;
    let bytes = match body["encoding"].as_str() {
        Some("base64") => STANDARD.decode(content).map_err(|_| "replayIncomplete")?,
        Some("utf-8") => content.as_bytes().to_vec(),
        _ => return Err("replayUnsupported".into()),
    };
    *request.body_mut() = Some(bytes.into());
    if let Some(query) = query_override {
        request.url_mut().set_query(if query.is_empty() {
            None
        } else {
            Some(query.trim_start_matches('?'))
        });
    }
    if let Some(body) = body_override {
        if body.len() > 1024 * 1024 {
            return Err("replayIncomplete".into());
        }
        // Edited text is no longer the original compressed payload.
        request.headers_mut().remove(reqwest::header::CONTENT_ENCODING);
        *request.body_mut() = Some(body.as_bytes().to_vec().into());
    }
    Ok(request)
}

/// Replay once through the capture proxy, preserving normal TLS verification.
/// Redirects and automatic retries are disabled to avoid additional side effects.
#[tauri::command]
#[specta::specta]
pub async fn capture_replay(
    id: String,
    query: Option<String>,
    body: Option<String>,
) -> Result<crate::ipc::JsonValue, String> {
    if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("replayUnsupported".into());
    }
    let flow = capture_api_value("GET".into(), format!("flows/{id}"), None).await?;
    let request = replay_request(&flow, query.as_deref(), body.as_deref())?;
    let url = request.url().to_string();
    let ca = fs::read(data_dir()?.join("ca.pem")).map_err(|e| e.to_string())?;
    let certificate = extract_certificate(&ca).ok_or("replayUnsupported")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{PROXY_PORT}")).map_err(|e| e.to_string())?)
        .add_root_certificate(reqwest::Certificate::from_pem(&certificate).map_err(|e| e.to_string())?)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.execute(request).await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers: Vec<[String; 2]> = response
        .headers()
        .iter()
        .map(|(name, value)| [name.to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()])
        .collect();
    let mut content = Vec::new();
    let mut bytes = 0usize;
    // Stream the full response but cap the inspector copy, just like capture bodies.
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        bytes += chunk.len();
        let keep = chunk.len().min((1024 * 1024usize).saturating_sub(content.len()));
        content.extend_from_slice(&chunk[..keep]);
    }
    serde_json::from_value(serde_json::json!({"status":status,"url":url,"response":{
        "headers":headers,"body":STANDARD.encode(&content),"encoding":"base64",
        "bytes":bytes,"truncated":bytes>content.len(),"complete":true
    }}))
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod replay_tests {
    use super::*;

    fn flow() -> serde_json::Value {
        serde_json::json!({
            "method": "POST", "url": "http://127.0.0.1/upload",
            "request": {
                "complete": true, "truncated": false, "encoding": "base64",
                "body": "AP8K", "headers": [
                    ["Content-Type", "application/octet-stream"],
                    ["Content-Length", "999"], ["Connection", "X-Transient"],
                    ["X-Transient", "discard"], ["X-Token", "keep"]
                ]
            }
        })
    }

    #[test]
    fn replay_preserves_binary_and_removes_connection_headers() {
        let request = replay_request(&flow(), None, None).unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), &[0, 255, 10]);
        assert_eq!(request.headers()["x-token"], "keep");
        for name in ["content-length", "connection", "x-transient"] {
            assert!(!request.headers().contains_key(name));
        }
    }

    #[test]
    fn replay_rejects_incomplete_truncated_and_legacy_captures() {
        for (field, value) in [("complete", false), ("truncated", true)] {
            let mut flow = flow();
            flow["request"][field] = value.into();
            assert_eq!(replay_request(&flow, None, None).unwrap_err(), "replayIncomplete");
        }
        let mut flow = flow();
        flow["request"].as_object_mut().unwrap().remove("complete");
        assert_eq!(replay_request(&flow, None, None).unwrap_err(), "replayIncomplete");
    }

    #[test]
    fn replay_edits_query_and_body_without_changing_the_original_capture() {
        let mut original = flow();
        original["request"]["headers"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!(["Content-Encoding", "gzip"]));
        let before = original.clone();
        let request = replay_request(&original, Some("page=2&value=%2B"), Some("edited body")).unwrap();
        assert_eq!(request.url().query(), Some("page=2&value=%2B"));
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), b"edited body");
        assert!(!request.headers().contains_key("content-encoding"));
        assert_eq!(original, before);
    }

    #[test]
    fn replay_rejects_tunnels_and_upgrades() {
        let mut tunnel = flow();
        tunnel["method"] = "CONNECT".into();
        assert_eq!(replay_request(&tunnel, None, None).unwrap_err(), "replayUnsupported");
        let mut upgrade = flow();
        upgrade["request"]["headers"] = serde_json::json!([["Upgrade", "websocket"]]);
        assert_eq!(replay_request(&upgrade, None, None).unwrap_err(), "replayUnsupported");
    }
}

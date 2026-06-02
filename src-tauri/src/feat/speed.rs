use std::{
    net::TcpListener,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime},
};

use anyhow::Context as _;
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};

use crate::{config::Config, core::handle, process::AsyncHandler, utils};

static SPEED_TEST_CANCEL_EPOCH: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
static SPEED_TEST_CANCEL_NOTIFY: Lazy<tokio::sync::Notify> = Lazy::new(tokio::sync::Notify::new);

const DEFAULT_CLOUDFLARE_BYTES: u64 = 50 * 1024 * 1024;
const MIN_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const MIN_TEST_DURATION_MS: u64 = 1_000;
const MAX_TEST_DURATION_MS: u64 = 30_000;
const WARMUP_MS: u64 = 1_000;
const SAMPLE_MS: u64 = 500;
const FIRST_CHUNK_TIMEOUT_MS: u64 = 10_000;
const IDLE_CHUNK_TIMEOUT_MS: u64 = 4_000;
const ISOLATED_CORE_CONTROLLER_WAIT_SECS: u64 = 15;
const ISOLATED_CORE_PROXY_WAIT_SECS: u64 = 15;
const ISOLATED_CORE_SELECT_TIMEOUT_SECS: u64 = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSpeedResult {
    pub bytes: u64,
    pub measured_bytes: u64,
    pub elapsed_ms: u64,
    pub warmup_ms: u64,
    pub ttfb_ms: u64,
    pub bytes_per_second: f64,
    pub sample_count: usize,
    pub drop_count: usize,
    pub drop_rate: f64,
    pub stability: f64,
    pub jitter_ms: f64,
    pub early_eof: bool,
}

pub fn cancel_proxy_download_speed_tests() {
    SPEED_TEST_CANCEL_EPOCH.fetch_add(1, Ordering::SeqCst);
    SPEED_TEST_CANCEL_NOTIFY.notify_waiters();
    logging!(info, Type::Core, "cancel all proxy download speed tests");
}

fn ensure_speed_test_not_cancelled(test_id: u64) -> anyhow::Result<()> {
    if SPEED_TEST_CANCEL_EPOCH.load(Ordering::SeqCst) == test_id {
        Ok(())
    } else {
        Err(anyhow::anyhow!("Download speed test cancelled"))
    }
}

pub async fn test_proxy_download_speed(
    group_name: String,
    proxy_name: String,
    url: String,
    timeout: u64,
    max_bytes: u64,
    duration_ms: u64,
) -> anyhow::Result<DownloadSpeedResult> {
    let url = normalize_download_url(&url)?;
    let capped_max_bytes = max_bytes.clamp(MIN_DOWNLOAD_BYTES, MAX_DOWNLOAD_BYTES);
    let duration_ms = duration_ms.clamp(MIN_TEST_DURATION_MS, MAX_TEST_DURATION_MS);
    let timeout_duration = Duration::from_millis(timeout.clamp(3_000, 90_000));
    let test_id = SPEED_TEST_CANCEL_EPOCH.load(Ordering::SeqCst);
    ensure_speed_test_not_cancelled(test_id)?;

    let isolated = start_isolated_speed_test_core(&group_name, &proxy_name).await?;
    ensure_speed_test_not_cancelled(test_id)?;

    let result = tokio::time::timeout(
        timeout_duration,
        download_partial_through_proxy(url, isolated.mixed_port, capped_max_bytes, duration_ms, test_id),
    )
    .await;

    result.map_err(|_| anyhow::anyhow!("Download speed test timed out"))?
}

fn normalize_download_url(input: &str) -> anyhow::Result<String> {
    let trimmed = input.trim();
    let mut parsed = tauri::Url::parse(trimmed)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(anyhow::anyhow!("Only HTTP and HTTPS URLs are supported"));
    }

    // /__down is the Cloudflare speed endpoint convention. It is useful for
    // speed.cloudflare.com but not guaranteed for arbitrary bare domains.
    if parsed.path().is_empty() || parsed.path() == "/" {
        parsed.set_path("/__down");
        parsed.set_query(Some(&format!("bytes={DEFAULT_CLOUDFLARE_BYTES}")));
    }

    Ok(parsed.to_string())
}

struct IsolatedSpeedTestCore {
    mixed_port: u16,
    config_file: std::path::PathBuf,
    child: Option<tauri_plugin_shell::process::CommandChild>,
}

impl Drop for IsolatedSpeedTestCore {
    fn drop(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
        let _ = std::fs::remove_file(&self.config_file);
    }
}

async fn start_isolated_speed_test_core(group_name: &str, proxy_name: &str) -> anyhow::Result<IsolatedSpeedTestCore> {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    use tauri_plugin_shell::ShellExt as _;

    let (mixed_port, controller_port, dns_port) = take_three_available_local_ports()?;
    let mut config = isolated_speed_test_config(group_name, mixed_port, controller_port, dns_port).await?;

    let app_home_dir = utils::dirs::app_home_dir()?;
    let temp_dir = app_home_dir.join("speed-test");
    std::fs::create_dir_all(&temp_dir)?;
    cleanup_stale_speed_test_configs(&temp_dir);
    let config_file = temp_dir.join(format!("{}.yaml", nanoid::nanoid!(12)));
    std::fs::write(&config_file, serde_yaml_ng::to_string(&config)?)?;
    config.clear();

    let app_handle = handle::Handle::app_handle();
    let clash_core = Config::verge().await.latest_arc().get_valid_clash_core();
    let app_home_dir_str = utils::dirs::path_to_str(&app_home_dir)?;
    let config_file_str = utils::dirs::path_to_str(&config_file)?;

    let (mut rx, child) = match app_handle
        .shell()
        .sidecar(clash_core.as_str())?
        .args(["-d", app_home_dir_str, "-f", config_file_str])
        .spawn()
    {
        Ok(result) => result,
        Err(err) => {
            let _ = std::fs::remove_file(&config_file);
            return Err(err).context("Failed to start isolated mihomo speed test core");
        }
    };

    AsyncHandler::spawn(|| async move {
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stderr(line)
            | tauri_plugin_shell::process::CommandEvent::Stdout(line) = event
            {
                // Drain sidecar output so the process cannot block. Do not log it:
                // mihomo output may include proxy names, target hosts, or config details.
                let _ = line.len();
            }
        }
    });

    let core = IsolatedSpeedTestCore {
        mixed_port,
        config_file,
        child: Some(child),
    };

    wait_for_isolated_controller(controller_port, Duration::from_secs(ISOLATED_CORE_CONTROLLER_WAIT_SECS)).await?;

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(ISOLATED_CORE_SELECT_TIMEOUT_SECS))
        .build()?;
    let encoded_group = utf8_percent_encode(group_name, NON_ALPHANUMERIC).to_string();
    let select_url = format!("http://127.0.0.1:{controller_port}/proxies/{encoded_group}");
    let response = client
        .put(select_url)
        .json(&serde_json::json!({ "name": proxy_name }))
        .send()
        .await
        .with_context(|| format!("Failed to select proxy {proxy_name} in isolated group {group_name}"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Isolated proxy selection failed for {group_name} -> {proxy_name}: {}",
            response.status()
        ));
    }

    verify_isolated_proxy_selection(&client, controller_port, &encoded_group, proxy_name).await?;
    wait_for_proxy_port(mixed_port, Duration::from_secs(ISOLATED_CORE_PROXY_WAIT_SECS)).await?;
    Ok(core)
}

fn cleanup_stale_speed_test_configs(temp_dir: &std::path::Path) {
    const STALE_SECS: u64 = 6 * 60 * 60;

    let Ok(entries) = std::fs::read_dir(temp_dir) else {
        return;
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("yaml") {
            continue;
        }

        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > Duration::from_secs(STALE_SECS));

        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

async fn verify_isolated_proxy_selection(
    client: &reqwest::Client,
    controller_port: u16,
    encoded_group: &str,
    proxy_name: &str,
) -> anyhow::Result<()> {
    let verify_url = format!("http://127.0.0.1:{controller_port}/proxies/{encoded_group}");
    let response = client
        .get(verify_url)
        .send()
        .await
        .context("Failed to verify isolated proxy selection")?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Failed to verify isolated proxy selection: {}",
            response.status()
        ));
    }

    let value: serde_json::Value = response
        .json()
        .await
        .context("Failed to parse isolated proxy selection state")?;
    let selected = value.get("now").and_then(serde_json::Value::as_str);
    if selected != Some(proxy_name) {
        return Err(anyhow::anyhow!(
            "Isolated proxy selection mismatch: expected {proxy_name}, got {}",
            selected.unwrap_or("unknown")
        ));
    }

    Ok(())
}

async fn isolated_speed_test_config(
    group_name: &str,
    mixed_port: u16,
    controller_port: u16,
    dns_port: u16,
) -> anyhow::Result<Mapping> {
    let runtime = Config::runtime().await.latest_arc();
    let mut config = runtime
        .config
        .as_ref()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Runtime config is not ready"))?;

    if group_name != "GLOBAL" && !runtime_config_has_group(&config, group_name) {
        return Err(anyhow::anyhow!("Proxy group not found in runtime config: {group_name}"));
    }

    for key in [
        "port",
        "socks-port",
        "redir-port",
        "tproxy-port",
        "mixed-port",
        "bind-address",
        "external-controller",
        "external-controller-pipe",
        "external-controller-unix",
        "listeners",
        "tun",
        "rules",
    ] {
        config.remove(key);
    }
    sanitize_isolated_dns_config(&mut config, dns_port);

    config.insert(Value::from("mixed-port"), Value::from(mixed_port));
    config.insert(
        Value::from("external-controller"),
        Value::from(format!("127.0.0.1:{controller_port}")),
    );
    config.insert(Value::from("secret"), Value::from(""));
    config.insert(Value::from("allow-lan"), Value::from(false));
    config.insert(Value::from("bind-address"), Value::from("127.0.0.1"));
    config.insert(Value::from("mode"), Value::from("rule"));
    config.insert(
        Value::from("rules"),
        Value::Sequence(vec![Value::from(format!("MATCH,{group_name}"))]),
    );

    let mut profile = Mapping::new();
    profile.insert(Value::from("store-selected"), Value::from(false));
    profile.insert(Value::from("store-fake-ip"), Value::from(false));
    config.insert(Value::from("profile"), Value::Mapping(profile));

    Ok(config)
}

fn sanitize_isolated_dns_config(config: &mut Mapping, dns_port: u16) {
    let Some(Value::Mapping(dns)) = config.get_mut("dns") else {
        return;
    };

    dns.insert(Value::from("enable"), Value::from(true));
    dns.insert(Value::from("listen"), Value::from(format!("127.0.0.1:{dns_port}")));
}

fn runtime_config_has_group(config: &Mapping, group_name: &str) -> bool {
    config
        .get("proxy-groups")
        .and_then(Value::as_sequence)
        .is_some_and(|groups| {
            groups.iter().any(|group| {
                group
                    .as_mapping()
                    .and_then(|group| group.get("name"))
                    .and_then(Value::as_str)
                    .is_some_and(|name| name == group_name)
            })
        })
}

fn take_three_available_local_ports() -> anyhow::Result<(u16, u16, u16)> {
    let first = TcpListener::bind(("127.0.0.1", 0))?;
    let second = TcpListener::bind(("127.0.0.1", 0))?;
    let third = TcpListener::bind(("127.0.0.1", 0))?;
    Ok((
        first.local_addr()?.port(),
        second.local_addr()?.port(),
        third.local_addr()?.port(),
    ))
}

async fn wait_for_isolated_controller(port: u16, timeout: Duration) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(800))
        .build()?;
    let url = format!("http://127.0.0.1:{port}/version");
    let start = tokio::time::Instant::now();

    loop {
        if let Ok(response) = client.get(&url).send().await
            && response.status().is_success()
        {
            return Ok(());
        }

        if start.elapsed() >= timeout {
            return Err(anyhow::anyhow!("Timed out waiting for isolated mihomo controller"));
        }

        tokio::time::sleep(Duration::from_millis(120)).await;
    }
}

async fn wait_for_proxy_port(port: u16, timeout: Duration) -> anyhow::Result<()> {
    use tokio::net::TcpStream;

    let start = tokio::time::Instant::now();
    loop {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }

        if start.elapsed() >= timeout {
            return Err(anyhow::anyhow!("Timed out waiting for isolated mihomo proxy port"));
        }

        tokio::time::sleep(Duration::from_millis(120)).await;
    }
}

async fn download_partial_through_proxy(
    url: String,
    proxy_port: u16,
    max_bytes: u64,
    duration_ms: u64,
    test_id: u64,
) -> anyhow::Result<DownloadSpeedResult> {
    use reqwest::header::RANGE;
    use tokio::time::{Instant, timeout};

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{proxy_port}"))?)
        .user_agent("Mozilla/5.0 Clash Verge Download Speed Test")
        .build()?;

    ensure_speed_test_not_cancelled(test_id)?;

    let request_start = Instant::now();
    let mut response = match client
        .get(url.as_str())
        .header(RANGE, format!("bytes=0-{}", max_bytes.saturating_sub(1)))
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            let err = err.without_url();
            return Err(anyhow::anyhow!(
                "Failed to start download speed test request: {}",
                error_chain_message(&err)
            ));
        }
    };
    let ttfb_ms = request_start.elapsed().as_millis() as u64;

    ensure_speed_test_not_cancelled(test_id)?;

    let status = response.status();
    if !(status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT) {
        return Err(anyhow::anyhow!("Download speed test HTTP status: {status}"));
    }

    let body_start = Instant::now();
    let mut measure_start: Option<Instant> = None;
    let mut sample_start = Instant::now();
    let mut total_bytes = 0_u64;
    let mut measured_bytes = 0_u64;
    let mut sample_bytes = 0_u64;
    let mut sample_speeds = Vec::new();
    let mut early_eof = false;

    loop {
        ensure_speed_test_not_cancelled(test_id)?;

        let chunk_timeout = if measure_start.is_some() {
            Duration::from_millis(IDLE_CHUNK_TIMEOUT_MS)
        } else {
            Duration::from_millis(FIRST_CHUNK_TIMEOUT_MS)
        };

        let chunk = tokio::select! {
            result = timeout(chunk_timeout, response.chunk()) => match result {
                Ok(chunk) => chunk.map_err(|err| {
                    let err = err.without_url();
                    anyhow::anyhow!(
                        "Download speed test body read failed: {}",
                        error_chain_message(&err)
                    )
                })?,
                Err(_) if measured_bytes > 0 => break,
                Err(_) => return Err(anyhow::anyhow!("Download speed test stalled before enough data")),
            },
            _ = SPEED_TEST_CANCEL_NOTIFY.notified() => {
                ensure_speed_test_not_cancelled(test_id)?;
                continue;
            }
        };

        let Some(chunk) = chunk else {
            early_eof = measure_start.is_some_and(|start| start.elapsed() < Duration::from_millis(duration_ms));
            break;
        };

        total_bytes += chunk.len() as u64;

        if total_bytes >= max_bytes {
            early_eof = measure_start.is_some_and(|start| start.elapsed() < Duration::from_millis(duration_ms));
            break;
        }

        if measure_start.is_none() {
            if body_start.elapsed() < Duration::from_millis(WARMUP_MS) {
                continue;
            }
            measure_start = Some(Instant::now());
            sample_start = Instant::now();
            sample_bytes = 0;
            continue;
        }

        let Some(start) = measure_start else {
            continue;
        };
        if start.elapsed() >= Duration::from_millis(duration_ms) {
            break;
        }

        measured_bytes += chunk.len() as u64;
        sample_bytes += chunk.len() as u64;

        if sample_start.elapsed() >= Duration::from_millis(SAMPLE_MS) {
            push_speed_sample(&mut sample_speeds, sample_bytes, sample_start.elapsed());
            sample_start = Instant::now();
            sample_bytes = 0;
        }
    }

    if measured_bytes == 0 {
        return Err(anyhow::anyhow!("Download speed test returned no measured data"));
    }

    if sample_bytes > 0 {
        push_speed_sample(&mut sample_speeds, sample_bytes, sample_start.elapsed());
    }

    let stats = speed_stats(&sample_speeds);
    let duration_seconds = duration_ms as f64 / 1000.0;
    let bytes_per_second = measured_bytes as f64 / duration_seconds.max(0.001);

    Ok(DownloadSpeedResult {
        bytes: total_bytes,
        measured_bytes,
        elapsed_ms: duration_ms,
        warmup_ms: WARMUP_MS,
        ttfb_ms,
        bytes_per_second,
        sample_count: sample_speeds.len(),
        drop_count: stats.drop_count,
        drop_rate: stats.drop_rate,
        stability: stats.stability,
        jitter_ms: stats.jitter_ms,
        early_eof,
    })
}

fn error_chain_message(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut source = error.source();

    while let Some(err) = source {
        let text = err.to_string();
        if !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        source = err.source();
    }

    message
}

fn push_speed_sample(samples: &mut Vec<f64>, bytes: u64, elapsed: Duration) {
    let seconds = elapsed.as_secs_f64();
    if bytes > 0 && seconds > 0.0 {
        samples.push(bytes as f64 / seconds);
    }
}

struct SpeedStats {
    drop_count: usize,
    drop_rate: f64,
    stability: f64,
    jitter_ms: f64,
}

fn speed_stats(samples: &[f64]) -> SpeedStats {
    let values = samples
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .collect::<Vec<_>>();

    if values.is_empty() {
        return SpeedStats {
            drop_count: 0,
            drop_rate: 0.0,
            stability: 0.0,
            jitter_ms: 1000.0,
        };
    }

    let drop_count = values
        .windows(2)
        .filter(|pair| pair[0] > 0.0 && pair[1] < pair[0] * 0.5)
        .count();
    let drop_rate = drop_count as f64 / values.len() as f64;
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let std_dev = if values.len() < 2 {
        0.0
    } else {
        let variance = values
            .iter()
            .map(|value| {
                let diff = value - mean;
                diff * diff
            })
            .sum::<f64>()
            / values.len() as f64;
        variance.sqrt()
    };
    let stability = if mean < 1024.0 {
        0.0
    } else {
        (1.0 - std_dev / mean).clamp(0.0, 1.0)
    };
    let jitter_ms = if mean <= 0.0 {
        1000.0
    } else {
        ((std_dev / mean) * 1000.0).clamp(0.0, 10_000.0)
    };

    SpeedStats {
        drop_count,
        drop_rate,
        stability,
        jitter_ms,
    }
}

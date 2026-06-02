use super::{CmdResult, StringifyErr as _};
use crate::{feat, utils::dirs};
use chrono::{Datelike as _, Local, NaiveDateTime, TimeZone as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use smartstring::alias::String;
use std::path::Path;
use tokio::{fs, io::AsyncWriteExt as _};

const MAX_TEST_LOGS: usize = 1000;
const TEST_LOG_RETENTION_DAYS: i64 = 7;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TestLogEntry {
    pub time: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    pub payload: String,
}

#[tauri::command]
pub async fn test_proxy_download_speed(
    group_name: String,
    proxy_name: String,
    url: String,
    timeout: u64,
    max_bytes: u64,
    duration_ms: u64,
) -> CmdResult<feat::DownloadSpeedResult> {
    feat::test_proxy_download_speed(
        group_name.to_string(),
        proxy_name.to_string(),
        url.to_string(),
        timeout,
        max_bytes,
        duration_ms,
    )
    .await
    .map_err(|err| format!("{err:#}").into())
}

#[tauri::command]
pub fn cancel_proxy_download_speed_tests() {
    feat::cancel_proxy_download_speed_tests();
}

#[tauri::command]
pub async fn read_speed_test_urls_config_file() -> CmdResult<String> {
    ensure_speed_test_urls_config_file().await.stringify_err()?;
    let path = dirs::speed_test_urls_path().stringify_err()?;
    let content = fs::read_to_string(path).await.stringify_err()?;
    Ok(strip_json_bom(&content).into())
}

#[tauri::command]
pub async fn save_speed_test_urls_config_file(content: String) -> CmdResult<()> {
    let content = strip_json_bom(&content);
    let _: serde_json::Value = serde_json::from_str(content.as_str()).stringify_err()?;
    let path = dirs::speed_test_urls_path().stringify_err()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.stringify_err()?;
    }
    fs::write(path, content.as_str()).await.stringify_err()
}

fn strip_json_bom(content: &str) -> std::string::String {
    content.trim_start_matches('\u{feff}').to_string()
}

#[tauri::command]
pub async fn reset_speed_test_urls_config_file() -> CmdResult<String> {
    let content = compact_default_speed_test_urls_config();
    let path = dirs::speed_test_urls_path().stringify_err()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.stringify_err()?;
    }
    fs::write(path, content.as_str()).await.stringify_err()?;
    Ok(content.into())
}

#[tauri::command]
pub async fn open_speed_test_urls_config_file() -> CmdResult<()> {
    ensure_speed_test_urls_config_file().await.stringify_err()?;
    let path = dirs::speed_test_urls_path().stringify_err()?;
    open::that(path).stringify_err()
}

#[tauri::command]
pub async fn append_test_logs(entries: Vec<TestLogEntry>) -> CmdResult<()> {
    if entries.is_empty() {
        return Ok(());
    }

    let path = dirs::test_log_path().stringify_err()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.stringify_err()?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .stringify_err()?;

    for entry in entries.into_iter().filter(|entry| !entry.payload.trim().is_empty()) {
        let sanitized = TestLogEntry {
            time: entry.time,
            r#type: Some("test".into()),
            payload: entry.payload,
        };
        let line = serde_json::to_string(&sanitized).stringify_err()?;
        file.write_all(line.as_bytes()).await.stringify_err()?;
        file.write_all(b"\n").await.stringify_err()?;
    }
    std::mem::drop(file);
    prune_test_log_file(&path).await.stringify_err()?;

    Ok(())
}

#[tauri::command]
pub async fn get_test_logs() -> CmdResult<Vec<TestLogEntry>> {
    let path = dirs::test_log_path().stringify_err()?;
    if !path.exists() {
        return Ok(vec![]);
    }

    prune_test_log_file(&path).await.stringify_err()?;
    read_recent_test_logs(&path).await.stringify_err()
}

#[tauri::command]
pub async fn clear_test_logs() -> CmdResult<()> {
    let path = dirs::test_log_path().stringify_err()?;
    if path.exists() {
        fs::write(path, "").await.stringify_err()?;
    }
    Ok(())
}

async fn ensure_speed_test_urls_config_file() -> anyhow::Result<()> {
    let path = dirs::speed_test_urls_path()?;
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(path, compact_default_speed_test_urls_config()).await?;
    Ok(())
}

fn compact_default_speed_test_urls_config() -> std::string::String {
    serde_json::to_string_pretty(&json!({
        "version": 2,
        "test_duration_ms": 5000,
        "targets": [
            {
                "name": "ovh-sgp",
                "url": "https://sgp.proof.ovh.net/files/100Mb.dat",
                "region": "SG",
                "priority": 1,
                "enabled": true,
                "note": "OVH 官方测速，新加坡，实测零失败",
                "failures": []
            },
            {
                "name": "ovh-fra",
                "url": "https://fra.proof.ovh.net/files/100Mb.dat",
                "region": "EU",
                "priority": 2,
                "enabled": true,
                "note": "OVH 官方测速，法兰克福，实测零失败",
                "failures": []
            },
            {
                "name": "hetzner-fsn",
                "url": "https://fsn1-speed.hetzner.com/100MB.bin",
                "region": "EU",
                "priority": 3,
                "enabled": true,
                "note": "Hetzner 官方测速，德国，实测零失败",
                "failures": []
            },
            {
                "name": "leaseweb-hkg",
                "url": "https://speedtest.hkg12.hk.leaseweb.net/100mb.bin",
                "region": "HK",
                "priority": 4,
                "enabled": true,
                "note": "Leaseweb 专用测速，香港，部分出口 IP 可能被拒",
                "failures": []
            },
            {
                "name": "leaseweb-tyo",
                "url": "https://speedtest.tyo11.jp.leaseweb.net/100mb.bin",
                "region": "JP",
                "priority": 5,
                "enabled": true,
                "note": "Leaseweb 专用测速，东京，部分出口 IP 可能被拒",
                "failures": []
            },
            {
                "name": "cloudflare",
                "url": "https://speed.cloudflare.com/__down?bytes=52428800",
                "region": "Global",
                "priority": 6,
                "enabled": true,
                "note": "Cloudflare 动态测速，全球 PoP；部分代理出口 IP 会被 403",
                "failures": []
            }
        ]
    }))
    .unwrap_or_else(|_| "{\"version\":2,\"test_duration_ms\":5000,\"targets\":[]}".into())
        + "\n"
}

#[allow(dead_code)]
fn default_speed_test_urls_config() -> std::string::String {
    serde_json::to_string_pretty(&json!({
        "version": 2,
        "test_duration_ms": 5000,
        "targets": [
            {
                "name": "cloudflare",
                "url": "https://speed.cloudflare.com/__down?bytes=52428800",
                "region": "Global",
                "priority": 1,
                "note": "最稳定首选，全球 PoP，永久有效"
            },
            {
                "name": "leaseweb-hkg",
                "url": "https://speedtest.hkg12.hk.leaseweb.net/100mb.bin",
                "region": "HK",
                "priority": 1,
                "note": "专用测速服务器，HTTPS，香港"
            },
            {
                "name": "leaseweb-tyo",
                "url": "https://speedtest.tyo11.jp.leaseweb.net/100mb.bin",
                "region": "JP",
                "priority": 1,
                "note": "专用测速服务器，HTTPS，东京"
            },
            {
                "name": "vultr-sgp",
                "url": "https://sgp-ping.vultr.com/vultr.com.100MB.bin",
                "region": "SG",
                "priority": 1,
                "note": "Vultr 官方测速，新加坡"
            },
            {
                "name": "vultr-tyo",
                "url": "https://hnd-jp-ping.vultr.com/vultr.com.100MB.bin",
                "region": "JP",
                "priority": 1,
                "note": "Vultr 官方测速，东京"
            },
            {
                "name": "vultr-lax",
                "url": "https://lax-ca-us-ping.vultr.com/vultr.com.100MB.bin",
                "region": "US-West",
                "priority": 2,
                "note": "Vultr 官方测速，洛杉矶"
            },
            {
                "name": "vultr-nj",
                "url": "https://nj-us-ping.vultr.com/vultr.com.100MB.bin",
                "region": "US-East",
                "priority": 2,
                "note": "Vultr 官方测速，新泽西"
            },
            {
                "name": "ovh-sgp",
                "url": "https://sgp.proof.ovh.net/files/100Mb.dat",
                "region": "SG",
                "priority": 2,
                "note": "OVH 官方测速，新加坡"
            },
            {
                "name": "ovh-fra",
                "url": "https://fra.proof.ovh.net/files/100Mb.dat",
                "region": "EU",
                "priority": 3,
                "note": "OVH 官方测速，法兰克福"
            },
            {
                "name": "hetzner-fsn",
                "url": "https://fsn1-speed.hetzner.com/100MB.bin",
                "region": "EU",
                "priority": 3,
                "note": "Hetzner 官方测速，德国"
            }
        ]
    }))
    .unwrap_or_else(|_| "{\"version\":2,\"test_duration_ms\":5000,\"targets\":[]}".into())
        + "\n"
}

async fn prune_test_log_file(path: &Path) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let logs = read_recent_test_logs(path).await?;
    let mut content = std::string::String::new();
    for entry in logs {
        content.push_str(&serde_json::to_string(&entry)?);
        content.push('\n');
    }
    fs::write(path, content).await?;
    Ok(())
}

async fn read_recent_test_logs(path: &Path) -> anyhow::Result<Vec<TestLogEntry>> {
    let content = fs::read_to_string(path).await?;
    let mut logs = content
        .lines()
        .filter_map(|line| serde_json::from_str::<TestLogEntry>(line).ok())
        .filter(|entry| !entry.payload.trim().is_empty())
        .filter(is_recent_test_log)
        .collect::<Vec<_>>();

    if logs.len() > MAX_TEST_LOGS {
        logs = logs.split_off(logs.len() - MAX_TEST_LOGS);
    }

    Ok(logs)
}

fn is_recent_test_log(entry: &TestLogEntry) -> bool {
    let Some(time) = entry.time.as_deref() else {
        return true;
    };
    let now = Local::now();
    let parsed = NaiveDateTime::parse_from_str(time, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(format!("{}-{time}", now.year()).as_str(), "%Y-%m-%d %H:%M:%S"));

    let Ok(naive) = parsed else {
        return true;
    };
    let Some(log_time) = Local.from_local_datetime(&naive).single() else {
        return true;
    };

    now.signed_duration_since(log_time).num_days() <= TEST_LOG_RETENTION_DAYS
}

use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use serde::Serialize;
use std::{env, path::Path, process::Stdio};
use tokio::process::Command;

const CN_RECOMMENDED_SERVERS: &[&str] = &["ntp.ntsc.ac.cn", "210.72.145.44", "ntp.aliyun.com"];

const GLOBAL_RECOMMENDED_SERVERS: &[&str] =
    &["time.cloudflare.com", "time.google.com", "pool.ntp.org"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NtpStatus {
    pub enabled: bool,
    pub using_recommended: bool,
    pub server: Option<String>,
    pub provider: Option<String>,
    pub message: Option<String>,
    pub platform: String,
    pub can_configure: bool,
    pub recommended_servers: Vec<String>,
}

pub async fn check_ntp_status() -> Result<NtpStatus> {
    platform_check_ntp_status().await
}

pub async fn sync_ntp_once() -> Result<()> {
    platform_sync_ntp().await
}

pub async fn apply_recommended_ntp() -> Result<NtpStatus> {
    platform_apply_recommended_ntp().await
}

fn recommended_servers() -> Vec<String> {
    let is_cn = is_cn_like_locale();
    let mut seen = std::collections::HashSet::new();
    let mut servers = Vec::new();

    let push_unique =
        |list: &[&str], seen: &mut std::collections::HashSet<String>, out: &mut Vec<String>| {
            for &item in list {
                let key = item.to_ascii_lowercase();
                if seen.insert(key) {
                    out.push(item.to_string());
                }
            }
        };

    if is_cn {
        push_unique(CN_RECOMMENDED_SERVERS, &mut seen, &mut servers);
    } else {
        push_unique(GLOBAL_RECOMMENDED_SERVERS, &mut seen, &mut servers);
    }

    // Always append global fallback to ensure we have a public pool for overseas users
    push_unique(GLOBAL_RECOMMENDED_SERVERS, &mut seen, &mut servers);

    servers
}

fn is_recommended(server: &str) -> bool {
    let lower = server.to_ascii_lowercase();
    recommended_servers()
        .iter()
        .any(|s| lower.contains(&s.to_ascii_lowercase()))
}

fn is_cn_like_locale() -> bool {
    let locale = sys_locale::get_locale()
        .unwrap_or_default()
        .to_ascii_lowercase();
    locale.contains("zh") || locale.contains("cn")
}

fn command_exists(command: &str) -> bool {
    let path = Path::new(command);
    if path.is_file() {
        return true;
    }

    if let Some(paths) = env::var_os("PATH") {
        for p in env::split_paths(&paths) {
            let candidate = p.join(command);
            if candidate.is_file() {
                return true;
            }
            #[cfg(target_os = "windows")]
            {
                let exe_candidate = candidate.with_extension("exe");
                if exe_candidate.is_file() {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
async fn run_command(command: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .with_context(|| format!("failed to spawn {}", command))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!("{} {:?} failed: {}", command, args, stderr.trim())
}

#[cfg(target_os = "windows")]
use winreg::{
    RegKey,
    enums::{HKEY_LOCAL_MACHINE, KEY_READ},
};

#[cfg(target_os = "windows")]
fn recommended_peer_list() -> String {
    recommended_servers()
        .into_iter()
        .map(|s| format!("{s},0x9"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
async fn ensure_windows_time_service() {
    if !command_exists("sc") {
        return;
    }

    let _ = Command::new("sc")
        .args(["start", "w32time"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
}

#[cfg(target_os = "windows")]
fn platform_check_ntp_status_sync() -> NtpStatus {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut using_recommended = false;

    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(
        "SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters",
        KEY_READ,
    ) {
        Ok(key) => {
            let ntp_server: String = key.get_value("NtpServer").unwrap_or_default();
            let sync_type: String = key.get_value("Type").unwrap_or_default();
            enabled = !ntp_server.trim().is_empty() && !sync_type.eq_ignore_ascii_case("NoSync");

            if !ntp_server.trim().is_empty() {
                using_recommended = is_recommended(&ntp_server);
                server = Some(ntp_server);
            }
        }
        Err(err) => {
            message = Some(format!("registry read failed: {err}"));
        }
    }

    NtpStatus {
        enabled,
        using_recommended,
        server,
        provider: Some("w32time".into()),
        message,
        platform: "windows".into(),
        can_configure: command_exists("w32tm"),
        recommended_servers: recommended_servers(),
    }
}

#[cfg(target_os = "windows")]
fn platform_check_ntp_status() -> impl std::future::Future<Output = Result<NtpStatus>> {
    futures::future::ready(Ok(platform_check_ntp_status_sync()))
}

#[cfg(target_os = "windows")]
async fn platform_sync_ntp() -> Result<()> {
    logging!(info, Type::System, "Triggering Windows time resync");
    ensure_windows_time_service().await;

    let output = Command::new("w32tm")
        .args(["/resync", "/force"])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to run w32tm for resync")?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!("w32tm resync failed: {}", stderr.trim());
}

#[cfg(target_os = "windows")]
async fn platform_apply_recommended_ntp() -> Result<NtpStatus> {
    let peer_list = recommended_peer_list();
    logging!(
        info,
        Type::System,
        "Applying recommended NTP server list: {}",
        peer_list
    );

    ensure_windows_time_service().await;

    let output = Command::new("w32tm")
        .args([
            "/config",
            &format!("/manualpeerlist:{peer_list}"),
            "/syncfromflags:manual",
            "/update",
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to run w32tm /config")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("w32tm /config failed: {}", stderr.trim());
    }

    let _ = platform_sync_ntp().await;
    platform_check_ntp_status().await
}

#[cfg(target_os = "macos")]
const SYSTEM_SETUP: &str = "/usr/sbin/systemsetup";

#[cfg(target_os = "macos")]
async fn platform_check_ntp_status() -> Result<NtpStatus> {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut using_recommended = false;

    if command_exists(SYSTEM_SETUP) {
        match run_command(SYSTEM_SETUP, &["-getusingnetworktime"]).await {
            Ok(output) => {
                let lower = output.to_ascii_lowercase();
                enabled = lower.contains("on") || lower.contains("yes");
            }
            Err(err) => {
                message = Some(err.to_string());
            }
        }

        if let Ok(output) = run_command(SYSTEM_SETUP, &["-getnetworktimeserver"]).await {
            let trimmed = output.trim();
            if !trimmed.is_empty() {
                server = Some(trimmed.to_string());
                using_recommended = is_recommended(trimmed);
            }
        }
    } else {
        message = Some("systemsetup is not available".into());
    }

    Ok(NtpStatus {
        enabled,
        using_recommended,
        server,
        provider: Some("systemsetup".into()),
        message,
        platform: "macos".into(),
        can_configure: command_exists(SYSTEM_SETUP) || command_exists("sntp"),
        recommended_servers: recommended_servers(),
    })
}

#[cfg(target_os = "macos")]
async fn platform_sync_ntp() -> Result<()> {
    let server = recommended_servers()
        .get(0)
        .cloned()
        .unwrap_or_else(|| "time.apple.com".into());

    if command_exists("sntp") {
        logging!(
            info,
            Type::System,
            "Triggering macOS NTP sync via sntp using {}",
            server
        );
        let _ = run_command("sntp", &["-sS", &server]).await?;
        return Ok(());
    }

    bail!("no available NTP sync tool (sntp) found on macOS")
}

#[cfg(target_os = "macos")]
async fn platform_apply_recommended_ntp() -> Result<NtpStatus> {
    let server = recommended_servers()
        .get(0)
        .cloned()
        .unwrap_or_else(|| "ntp.ntsc.ac.cn".into());

    if command_exists(SYSTEM_SETUP) {
        logging!(
            info,
            Type::System,
            "Applying macOS network time server: {}",
            server
        );
        run_command(SYSTEM_SETUP, &["-setnetworktimeserver", &server]).await?;
        let _ = run_command(SYSTEM_SETUP, &["-setusingnetworktime", "on"]).await?;
    }

    let _ = platform_sync_ntp().await;
    platform_check_ntp_status().await
}

#[cfg(target_os = "linux")]
async fn platform_check_ntp_status() -> Result<NtpStatus> {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut provider = None;

    if command_exists("timedatectl") {
        provider = Some("systemd-timesyncd".into());
        match run_command("timedatectl", &["show", "-p", "NTP", "--value"]).await {
            Ok(output) => {
                enabled = output.trim().eq_ignore_ascii_case("yes");
            }
            Err(err) => {
                message = Some(err.to_string());
            }
        }

        if let Ok(output) = run_command(
            "timedatectl",
            &["show-timesync", "--property", "ServerName", "--value"],
        )
        .await
        {
            let trimmed = output.trim();
            if !trimmed.is_empty() {
                server = Some(trimmed.to_string());
            }
        }
    } else if command_exists("chronyc") {
        provider = Some("chrony".into());
        match run_command("chronyc", &["tracking"]).await {
            Ok(output) => {
                enabled = !output.trim().is_empty();
            }
            Err(err) => {
                message = Some(err.to_string());
            }
        }
    } else {
        message = Some("no NTP utilities (timedatectl/chronyc) found".into());
    }

    let using_recommended = server.as_ref().map(|s| is_recommended(s)).unwrap_or(false);

    Ok(NtpStatus {
        enabled,
        using_recommended,
        server,
        provider,
        message,
        platform: "linux".into(),
        can_configure: command_exists("timedatectl")
            || command_exists("chronyc")
            || command_exists("ntpdate"),
        recommended_servers: recommended_servers(),
    })
}

#[cfg(target_os = "linux")]
async fn platform_sync_ntp() -> Result<()> {
    if command_exists("chronyc") {
        logging!(info, Type::System, "Triggering chrony makestep");
        if run_command("chronyc", &["-a", "makestep"]).await.is_ok() {
            return Ok(());
        }
    }

    if command_exists("ntpdate") {
        let server = recommended_servers()
            .get(0)
            .cloned()
            .unwrap_or_else(|| "pool.ntp.org".into());
        logging!(info, Type::System, "Triggering ntpdate sync via {}", server);
        let _ = run_command("ntpdate", &["-u", &server]).await?;
        return Ok(());
    }

    if command_exists("timedatectl") {
        logging!(
            info,
            Type::System,
            "Enabling NTP via timedatectl set-ntp true"
        );
        let _ = run_command("timedatectl", &["set-ntp", "true"]).await?;
        return Ok(());
    }

    bail!("no supported NTP sync command found on linux")
}

#[cfg(target_os = "linux")]
async fn platform_apply_recommended_ntp() -> Result<NtpStatus> {
    if command_exists("timedatectl") && Path::new("/run/systemd/system").exists() {
        let config_dir = Path::new("/etc/systemd/timesyncd.conf.d");
        let config_file = config_dir.join("clash-verge.conf");
        let content = format!("[Time]\nNTP={}\n", recommended_servers().join(" "));

        tokio::fs::create_dir_all(config_dir)
            .await
            .context("failed to create timesyncd config dir")?;
        tokio::fs::write(&config_file, content.as_bytes())
            .await
            .with_context(|| format!("failed to write {}", config_file.display()))?;

        let _ = run_command("timedatectl", &["set-ntp", "true"]).await?;
        let _ = run_command("systemctl", &["restart", "systemd-timesyncd"]).await?;
    }

    let _ = platform_sync_ntp().await;
    platform_check_ntp_status().await
}

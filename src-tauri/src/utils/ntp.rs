use crate::config::Config;
use anyhow::{Context as _, Result, bail};
use clash_verge_logging::{Type, logging};
use serde::Serialize;
use std::{collections::HashSet, env, path::Path, process::Stdio};
#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri_plugin_clash_verge_sysinfo::is_binary_admin;
use tokio::process::Command;

const CN_RECOMMENDED_SERVERS: &[&str] = &["ntp.ntsc.ac.cn", "210.72.145.44", "ntp.aliyun.com"];
const CN_TZ_TARGETS: &[&str] = &["asia/shanghai"];
const DEFAULT_GLOBAL_FALLBACK: &str = "pool.ntp.org";
const GLOBAL_RECOMMENDED_SERVERS: &[&str] = &[
    "time.cloudflare.com",
    "time.google.com",
    DEFAULT_GLOBAL_FALLBACK,
];
const MAX_RECOMMENDED: usize = 8;
#[cfg(target_os = "windows")]
// CREATE_NO_WINDOW to avoid flashing console windows when invoking CLI tools
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const WINDOWS_MANUAL_PEER_FLAG: &str = "0x9";
#[cfg(target_os = "windows")]
const W32TIME_PARAMETERS_KEY: &str = "SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters";
#[cfg(target_os = "linux")]
const TIMESYNCD_DROPIN_DIR: &str = "/etc/systemd/timesyncd.conf.d";
#[cfg(target_os = "linux")]
const TIMESYNCD_DROPIN_FILE: &str = "clash-verge.conf";

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

async fn recommended_servers() -> Vec<String> {
    // 1) user override via env
    let mut servers = normalize_servers(env_recommended_servers());

    // 2) user override via config
    if servers.is_empty() {
        servers = normalize_servers(config_recommended_servers().await);
    }

    // 3) locale-based defaults
    if servers.is_empty() {
        let defaults = if is_cn_like_locale() {
            CN_RECOMMENDED_SERVERS.to_vec()
        } else {
            GLOBAL_RECOMMENDED_SERVERS.to_vec()
        };
        servers = normalize_servers(defaults);
    }

    // 4) always ensure at least one global fallback is present
    let mut seen: HashSet<String> = HashSet::new();
    servers.retain(|s| seen.insert(s.to_ascii_lowercase()));
    if !has_global_recommended(&servers) {
        for &global in GLOBAL_RECOMMENDED_SERVERS {
            if seen.insert(global.to_ascii_lowercase()) {
                servers.push(global.to_string());
                break;
            }
        }
    }

    // 5) cap the list length to avoid runaway configs
    if servers.len() > MAX_RECOMMENDED {
        servers.truncate(MAX_RECOMMENDED);
    }
    let has_global = has_global_recommended(&servers);
    // ensure a global fallback survives the cap
    if !has_global && let Some(global) = GLOBAL_RECOMMENDED_SERVERS.first() {
        if servers.is_empty() {
            servers.push((*global).to_string());
        } else {
            let last = servers.len() - 1;
            servers[last] = (*global).to_string();
        }
    }

    servers
}

fn has_global_recommended(servers: &[String]) -> bool {
    servers.iter().any(|s| {
        GLOBAL_RECOMMENDED_SERVERS
            .iter()
            .any(|g| s.eq_ignore_ascii_case(g))
    })
}

fn is_recommended(server: &str, recommended: &[String]) -> bool {
    let lower = server.to_ascii_lowercase();
    recommended
        .iter()
        .any(|s| lower.contains(&s.to_ascii_lowercase()))
}

fn is_cn_like_locale() -> bool {
    let locale = sys_locale::get_locale()
        .unwrap_or_default()
        .to_ascii_lowercase();

    let tz = normalize_tz(&env::var("TZ").unwrap_or_default());

    let is_cn_tz = matches_timezone(&tz, CN_TZ_TARGETS);
    if is_cn_tz {
        return true;
    }

    let lang_region: Vec<&str> = locale.split(&['-', '_']).collect();
    if lang_region.is_empty() {
        return false;
    }

    let lang = lang_region[0];
    if lang != "zh" {
        return false;
    }

    let region = lang_region.get(1).copied().unwrap_or_default();
    if region.is_empty() {
        return false;
    }

    let region_lower = region.to_ascii_lowercase();
    matches!(region_lower.as_str(), "cn" | "hans" | "chs")
}

fn matches_timezone(tz: &str, targets: &[&str]) -> bool {
    targets.contains(&tz)
}

fn normalize_tz(tz: &str) -> String {
    let mut norm = tz.trim_start_matches(':').to_ascii_lowercase();
    if let Some(stripped) = norm.strip_prefix("posix/") {
        norm = stripped.to_string();
    }
    if let Some(stripped) = norm.strip_prefix("right/") {
        norm = stripped.to_string();
    }
    norm = match norm.as_str() {
        // normalize deprecated/alias zones to the canonical Asia/Shanghai
        "asia/beijing" | "asia/chongqing" | "asia/harbin" | "asia/urumqi" => {
            "asia/shanghai".to_string()
        }
        _ => norm,
    };
    norm
}

#[cfg(target_os = "linux")]
fn ensure_linux_privileges(action: &str) -> Result<()> {
    if !is_binary_admin() {
        bail!(
            "{action} requires root privileges (sudo). Please run Clash Verge with sudo or configure NTP in system settings."
        );
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_can_persist_ntp_config() -> bool {
    command_exists("timedatectl") && Path::new("/run/systemd/system").exists()
}

fn normalize_servers<S: AsRef<str>, I: IntoIterator<Item = S>>(iter: I) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for raw in iter {
        let trimmed = raw.as_ref().trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            result.push(trimmed.to_string());
        }
    }

    result
}

fn env_recommended_servers() -> Vec<String> {
    let env_servers = env::var("VERGE_NTP_SERVERS")
        .or_else(|_| env::var("CLASH_VERGE_NTP_SERVERS"))
        .unwrap_or_default();

    if env_servers.is_empty() {
        return Vec::new();
    }

    let list = env_servers
        .split(|c: char| c == ',' || c.is_whitespace())
        .map(str::to_string);
    normalize_servers(list)
}

async fn config_recommended_servers() -> Vec<String> {
    let verge = Config::verge().await.latest_arc();
    if let Some(list) = verge.ntp_servers.clone() {
        return normalize_servers(list);
    }
    Vec::new()
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
fn recommended_peer_list(servers: &[String]) -> String {
    servers
        .iter()
        .map(|s| format!("{s},{WINDOWS_MANUAL_PEER_FLAG}"))
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
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await;
}

#[cfg(target_os = "windows")]
async fn platform_check_ntp_status() -> Result<NtpStatus> {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut using_recommended = false;
    let is_admin = is_binary_admin();

    let recommended = recommended_servers().await;
    let has_w32tm = command_exists("w32tm");

    match RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(W32TIME_PARAMETERS_KEY, KEY_READ)
    {
        Ok(key) => {
            let ntp_server: String = key.get_value("NtpServer").unwrap_or_default();
            let sync_type: String = key.get_value("Type").unwrap_or_default();
            enabled = !ntp_server.trim().is_empty() && !sync_type.eq_ignore_ascii_case("NoSync");

            if !ntp_server.trim().is_empty() {
                using_recommended = is_recommended(&ntp_server, &recommended);
                server = Some(ntp_server);
            }
        }
        Err(err) => {
            message = Some(format!("registry read failed: {err}"));
        }
    }

    if message.is_none() && has_w32tm && !is_admin {
        message = Some(
            "Applying or syncing NTP on Windows requires Administrator privileges. Please run Clash Verge as Administrator."
                .into(),
        );
    }

    Ok(NtpStatus {
        enabled,
        using_recommended,
        server,
        provider: Some("w32time".into()),
        message,
        platform: "windows".into(),
        can_configure: has_w32tm && is_admin,
        recommended_servers: recommended,
    })
}

#[cfg(target_os = "windows")]
async fn platform_sync_ntp() -> Result<()> {
    if !is_binary_admin() {
        bail!(
            "Windows time sync requires Administrator privileges. Please run Clash Verge as Administrator."
        );
    }

    logging!(info, Type::System, "Triggering Windows time resync");
    ensure_windows_time_service().await;

    let output = Command::new("w32tm")
        .args(["/resync", "/force"])
        .creation_flags(CREATE_NO_WINDOW)
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
    if !is_binary_admin() {
        bail!(
            "Applying NTP settings requires Administrator privileges. Please run Clash Verge as Administrator."
        );
    }

    let recommended = recommended_servers().await;
    let peer_list = recommended_peer_list(&recommended);
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
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to run w32tm /config")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("w32tm /config failed: {}", stderr.trim());
    }

    let _ = platform_sync_ntp().await;

    // Prefer returning the latest status with the same recommended list we just applied
    let mut status = platform_check_ntp_status().await?;
    status.recommended_servers = recommended;
    Ok(status)
}

#[cfg(target_os = "macos")]
const SYSTEM_SETUP: &str = "/usr/sbin/systemsetup";

#[cfg(target_os = "macos")]
async fn platform_check_ntp_status() -> Result<NtpStatus> {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut using_recommended = false;
    let recommended = recommended_servers().await;

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
                using_recommended = is_recommended(trimmed, &recommended);
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
        recommended_servers: recommended,
    })
}

#[cfg(target_os = "macos")]
async fn platform_sync_ntp() -> Result<()> {
    let recommended = recommended_servers().await;
    let server = recommended
        .first()
        .cloned()
        .unwrap_or_else(|| DEFAULT_GLOBAL_FALLBACK.into());

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
    let recommended = recommended_servers().await;
    let server = recommended
        .first()
        .cloned()
        .unwrap_or_else(|| DEFAULT_GLOBAL_FALLBACK.into());

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
    let mut status = platform_check_ntp_status().await?;
    status.recommended_servers = recommended;
    Ok(status)
}

#[cfg(target_os = "linux")]
async fn platform_check_ntp_status() -> Result<NtpStatus> {
    let mut message = None;
    let mut enabled = false;
    let mut server = None;
    let mut provider = None;
    let recommended = recommended_servers().await;
    let is_admin = is_binary_admin();
    let can_persist = linux_can_persist_ntp_config();

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

    let using_recommended = server
        .as_ref()
        .map(|s| is_recommended(s, &recommended))
        .unwrap_or(false);
    if message.is_none() && !can_persist {
        message = Some(
            "systemd-timesyncd (timedatectl) is not available; auto configuration is unsupported"
                .into(),
        );
    } else if message.is_none() && can_persist && !is_admin {
        message = Some(
            "Configuring NTP servers requires root privileges (sudo). Please run Clash Verge as root or configure NTP in system settings."
                .into(),
        );
    }

    Ok(NtpStatus {
        enabled,
        using_recommended,
        server,
        provider,
        message,
        platform: "linux".into(),
        can_configure: can_persist && is_admin,
        recommended_servers: recommended,
    })
}

#[cfg(target_os = "linux")]
async fn platform_sync_ntp() -> Result<()> {
    ensure_linux_privileges("NTP sync operations on Linux")?;
    let recommended = recommended_servers().await;

    if command_exists("chronyc") {
        logging!(info, Type::System, "Triggering chrony makestep");
        if run_command("chronyc", &["-a", "makestep"]).await.is_ok() {
            return Ok(());
        }
    }

    if command_exists("ntpdate") {
        let server = recommended
            .first()
            .cloned()
            .unwrap_or_else(|| DEFAULT_GLOBAL_FALLBACK.into());
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
    ensure_linux_privileges("Applying NTP servers on Linux")?;
    if !linux_can_persist_ntp_config() {
        bail!(
            "Applying NTP servers requires systemd-timesyncd (timedatectl). This system does not support auto-configuration."
        );
    }
    let recommended = recommended_servers().await;

    let config_dir = Path::new(TIMESYNCD_DROPIN_DIR);
    let config_file = config_dir.join(TIMESYNCD_DROPIN_FILE);
    let content = format!("[Time]\nNTP={}\n", recommended.join(" "));

    tokio::fs::create_dir_all(config_dir)
        .await
        .context("failed to create timesyncd config dir")?;
    tokio::fs::write(&config_file, content.as_bytes())
        .await
        .with_context(|| format!("failed to write {}", config_file.display()))?;

    let _ = run_command("timedatectl", &["set-ntp", "true"]).await?;
    let _ = run_command("systemctl", &["restart", "systemd-timesyncd"]).await?;

    let _ = platform_sync_ntp().await;
    let mut status = platform_check_ntp_status().await?;
    status.recommended_servers = recommended;
    Ok(status)
}

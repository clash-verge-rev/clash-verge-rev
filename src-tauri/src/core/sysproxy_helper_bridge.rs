#![cfg(target_os = "macos")]

use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    io::Write as _,
    path::PathBuf,
    process::{Command as StdCommand, Stdio},
};
use sysproxy::{Autoproxy, Sysproxy};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyPayload {
    http_enabled: bool,
    http_host: String,
    http_port: u16,
    http_bypass: String,
    pac_enabled: bool,
    pac_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub installed: bool,
    pub xpc_ready: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeResult {
    pub success: bool,
    pub message: String,
}

fn bridge_binary_path() -> Result<PathBuf> {
    let res_dir = crate::utils::dirs::app_resources_dir()?;
    Ok(res_dir.join("proxy-helper").join("proxy-helper-bridge"))
}

fn ensure_bridge_exists() -> Result<PathBuf> {
    let path = bridge_binary_path()?;
    if !path.exists() {
        bail!(
            "missing system proxy helper bridge at {}; ensure macOS package is built through workflow",
            path.display()
        );
    }
    Ok(path)
}

fn run_bridge_with_json<T: for<'de> Deserialize<'de>>(args: &[&str], stdin: Option<&str>) -> Result<T> {
    let bridge = ensure_bridge_exists()?;
    let mut cmd = StdCommand::new(bridge);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });

    let mut child = cmd.spawn().context("failed to start system proxy helper bridge")?;
    if let Some(payload) = stdin
        && let Some(mut pipe) = child.stdin.take()
    {
        pipe.write_all(payload.as_bytes())
            .context("failed to send payload to bridge")?;
    }

    let output = child
        .wait_with_output()
        .context("failed to wait for system proxy helper bridge")?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "bridge command failed without output".into()
        };
        bail!("system proxy helper bridge failed: {details}");
    }

    serde_json::from_str::<T>(&stdout).with_context(|| format!("failed to parse bridge output: {stdout}"))
}

pub fn smjobbless_install(helper_label: &str) -> Result<()> {
    let result: BridgeResult = run_bridge_with_json(&["install", "--label", helper_label], None)?;
    if !result.success {
        bail!("{}", result.message);
    }
    Ok(())
}

pub fn read_status(helper_label: &str) -> Result<BridgeStatus> {
    run_bridge_with_json(&["status", "--label", helper_label], None)
}

pub fn xpc_apply(helper_label: &str, sys: &Sysproxy, auto: &Autoproxy) -> Result<()> {
    let payload = ApplyPayload {
        http_enabled: sys.enable,
        http_host: sys.host.clone(),
        http_port: sys.port,
        http_bypass: sys.bypass.clone(),
        pac_enabled: auto.enable,
        pac_url: auto.url.clone(),
    };
    let payload_json = serde_json::to_string(&payload).context("failed to serialize proxy apply payload")?;

    let result: BridgeResult = run_bridge_with_json(&["apply", "--label", helper_label], Some(&payload_json))?;

    if !result.success {
        bail!("{}", result.message);
    }
    Ok(())
}

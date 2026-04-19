#![cfg(target_os = "macos")]

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use sysproxy::{Autoproxy, Sysproxy};

#[cfg(feature = "verge-dev")]
pub const HELPER_LABEL: &str = "io.github.clash-verge-rev.clash-verge-rev.dev.proxyhelper";
#[cfg(not(feature = "verge-dev"))]
pub const HELPER_LABEL: &str = "io.github.clash-verge-rev.clash-verge-rev.proxyhelper";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperState {
    Unsupported,
    NotInstalled,
    Ready,
    RequiresSignedEnvironment,
    InstallFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatus {
    pub state: HelperState,
    pub helper_label: String,
    pub helper_path: Option<String>,
    pub launchd_path: Option<String>,
    pub installed: bool,
    pub xpc_ready: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub state: HelperState,
    pub installed: bool,
    pub needs_signed_environment: bool,
    pub message: String,
}

fn helper_install_target() -> std::path::PathBuf {
    std::path::PathBuf::from("/Library/PrivilegedHelperTools").join(HELPER_LABEL)
}

fn launchd_target() -> std::path::PathBuf {
    std::path::PathBuf::from("/Library/LaunchDaemons").join(format!("{HELPER_LABEL}.plist"))
}

fn build_status(installed: bool, xpc_ready: bool, state: HelperState, message: Option<String>) -> HelperStatus {
    HelperStatus {
        state,
        helper_label: HELPER_LABEL.to_string(),
        helper_path: Some(helper_install_target().display().to_string()),
        launchd_path: Some(launchd_target().display().to_string()),
        installed,
        xpc_ready,
        message,
    }
}

pub fn get_status() -> HelperStatus {
    match crate::core::sysproxy_helper_bridge::read_status(HELPER_LABEL) {
        Ok(status) => {
            if status.installed && status.xpc_ready {
                build_status(true, true, HelperState::Ready, status.message)
            } else if !status.installed {
                build_status(false, false, HelperState::NotInstalled, status.message)
            } else {
                build_status(true, false, HelperState::InstallFailed, status.message)
            }
        }
        Err(err) => build_status(false, false, HelperState::InstallFailed, Some(err.to_string())),
    }
}

pub fn install() -> InstallResult {
    let status = get_status();
    if status.state == HelperState::Ready {
        return InstallResult {
            state: HelperState::Ready,
            installed: true,
            needs_signed_environment: false,
            message: "System proxy helper is already installed and reachable".to_string(),
        };
    }

    match crate::core::sysproxy_helper_bridge::smjobbless_install(HELPER_LABEL) {
        Ok(()) => {
            let next_status = get_status();
            InstallResult {
                state: next_status.state,
                installed: next_status.installed,
                needs_signed_environment: next_status.state == HelperState::RequiresSignedEnvironment,
                message: next_status
                    .message
                    .unwrap_or_else(|| "System proxy helper install completed".to_string()),
            }
        }
        Err(err) => {
            let err_msg = err.to_string();
            let lower = err_msg.to_lowercase();
            let needs_signed_environment =
                lower.contains("smjobbless") || lower.contains("code signature") || lower.contains("signed");
            let state = if needs_signed_environment {
                HelperState::RequiresSignedEnvironment
            } else {
                HelperState::InstallFailed
            };
            InstallResult {
                state,
                installed: false,
                needs_signed_environment,
                message: err_msg,
            }
        }
    }
}

pub fn is_installed() -> bool {
    get_status().installed
}

pub fn apply_proxy_settings(sys: &Sysproxy, auto: &Autoproxy) -> Result<()> {
    let status = get_status();
    if !status.installed {
        bail!("system proxy helper unavailable: not installed via SMJobBless");
    }

    if status.state == HelperState::RequiresSignedEnvironment {
        bail!("system proxy helper unavailable: signed environment is required for XPC");
    }

    if !status.xpc_ready {
        bail!("system proxy helper unavailable: XPC service is not reachable");
    }

    crate::core::sysproxy_helper_bridge::xpc_apply(HELPER_LABEL, sys, auto)
}

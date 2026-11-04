//! Wi-Fi hotspot built on the Windows Mobile Hotspot API.
//!
//! Windows shares the mihomo TUN as the public side of Internet Connection
//! Sharing, so hotspot clients reach the core without extra routing rules.
//! All WinRT work runs on one dedicated thread; this module owns the state
//! machine, validation and the auto start/stop watcher.

use crate::config::Config;
use crate::core::handle::Handle;
use crate::singleton;
use anyhow::{Context as _, Result, bail};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

#[cfg(not(windows))]
mod unsupported;
#[cfg(windows)]
mod win;

#[cfg(not(windows))]
use unsupported as platform;
#[cfg(windows)]
use win as platform;

pub const DEFAULT_TUN_DEVICE: &str = "Mihomo";
const DEFAULT_SSID: &str = "ClashVerge";
const STATUS_POLL: Duration = Duration::from_secs(3);
const START_TIMEOUT: Duration = Duration::from_secs(150);
const STOP_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HotspotState {
    #[default]
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
    Unsupported,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotspotDevice {
    pub mac: std::string::String,
    pub hosts: Vec<std::string::String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotspotStatus {
    pub state: HotspotState,
    pub ssid: std::string::String,
    pub band: std::string::String,
    pub clients: u32,
    pub gateway: Option<std::string::String>,
    pub adapter: Option<std::string::String>,
    pub message: Option<std::string::String>,
    pub devices: Vec<HotspotDevice>,
    pub updated_at: i64,
}

impl HotspotStatus {
    fn starting(config: &HotspotStartConfig) -> Self {
        Self {
            state: HotspotState::Starting,
            ssid: config.ssid.clone(),
            band: config.band.clone(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotspotAdapter {
    pub id: std::string::String,
    pub name: std::string::String,
    pub description: std::string::String,
    pub status: std::string::String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotspotStartConfig {
    pub ssid: std::string::String,
    pub password: std::string::String,
    /// `auto`, `2.4` or `5`.
    pub band: std::string::String,
    /// Wi-Fi adapter GUID; empty selects the radio Windows prefers.
    pub adapter_id: Option<std::string::String>,
}

pub(crate) type Publisher = Arc<dyn Fn(HotspotStatus) + Send + Sync>;

pub fn validate_start_config(config: &HotspotStartConfig) -> Result<()> {
    let ssid = &config.ssid;
    if ssid.trim().is_empty() || ssid.len() > 32 || ssid.contains(['\0', '\r', '\n']) {
        bail!("hotspot name must be 1-32 bytes and must not contain line breaks");
    }
    if !(8..=63).contains(&config.password.len()) || !config.password.bytes().all(|byte| (32..=126).contains(&byte)) {
        bail!("hotspot password must be 8-63 printable ASCII characters");
    }
    if !matches!(config.band.as_str(), "auto" | "2.4" | "5") {
        bail!("unsupported hotspot band");
    }
    if let Some(adapter_id) = config.adapter_id.as_deref()
        && !adapter_id.is_empty()
        && parse_guid_text(adapter_id).is_none()
    {
        bail!("invalid hotspot adapter identifier");
    }
    Ok(())
}

fn parse_guid_text(text: &str) -> Option<u128> {
    let trimmed = text.trim_matches(|character| character == '{' || character == '}');
    let digits: std::string::String = trimmed.chars().filter(|character| *character != '-').collect();
    if digits.len() != 32 {
        return None;
    }
    u128::from_str_radix(&digits, 16).ok()
}

struct WorkerSlot {
    worker: platform::Worker,
}

pub struct HotspotManager {
    status: RwLock<HotspotStatus>,
    last_signature: Mutex<std::string::String>,
    worker: Mutex<Option<WorkerSlot>>,
    operation: tokio::sync::Mutex<()>,
    /// Set by an explicit stop so the auto watcher does not restart the AP
    /// until the TUN is torn down and brought back up.
    manual_stop: AtomicBool,
}

singleton!(HotspotManager, HOTSPOT_MANAGER);

impl Default for HotspotManager {
    fn default() -> Self {
        Self {
            status: RwLock::new(HotspotStatus {
                state: if cfg!(windows) {
                    HotspotState::Stopped
                } else {
                    HotspotState::Unsupported
                },
                ..HotspotStatus::default()
            }),
            last_signature: Mutex::new(std::string::String::new()),
            worker: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            manual_stop: AtomicBool::new(false),
        }
    }
}

impl HotspotManager {
    fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> HotspotStatus {
        self.status.read().clone()
    }

    pub const fn is_supported() -> bool {
        cfg!(windows)
    }

    fn is_idle(&self) -> bool {
        self.reap_finished();
        self.worker.lock().is_none()
    }

    fn publish(&self, status: HotspotStatus) {
        let signature = status_signature(&status);
        {
            let mut last = self.last_signature.lock();
            if *last == signature {
                return;
            }
            *last = signature;
        }

        let mut status = status;
        status.updated_at = chrono::Utc::now().timestamp_millis();
        *self.status.write() = status.clone();

        if crate::APP_HANDLE.get().is_some() {
            Handle::notify_hotspot_status(&status);
        }
    }

    pub async fn list_adapters(&self) -> Result<Vec<HotspotAdapter>> {
        tokio::task::spawn_blocking(platform::list_adapters)
            .await
            .context("hotspot adapter task failed")?
    }

    pub async fn start(&self, config: HotspotStartConfig) -> Result<HotspotStatus> {
        validate_start_config(&config)?;

        let _operation = self.operation.lock().await;
        self.reap_finished();
        if self.worker.lock().is_some() {
            bail!("hotspot is already running or stopping");
        }

        let tun_device = tun_device_name().await;
        let publisher: Publisher = Arc::new(|status| Self::global().publish(status));
        self.publish(HotspotStatus::starting(&config));

        let started = tokio::task::spawn_blocking(move || platform::start_worker(config, tun_device, publisher))
            .await
            .context("hotspot worker task failed")?;

        let (worker, status) = match started {
            Ok(started) => started,
            Err(error) => {
                // Unsupported platforms never reach a worker that could publish
                // its own failure, so settle the state here.
                let mut status = self.status();
                status.state = HotspotState::Failed;
                status.message = Some(format!("{error:#}"));
                self.publish(status);
                return Err(error);
            }
        };
        *self.worker.lock() = Some(WorkerSlot { worker });
        self.publish(status);
        Ok(self.status())
    }

    pub async fn stop(&self) -> Result<HotspotStatus> {
        let _operation = self.operation.lock().await;
        self.reap_finished();

        let Some(slot) = self.worker.lock().take() else {
            return Ok(self.status());
        };
        self.manual_stop.store(true, Ordering::Release);

        let mut stopping = self.status();
        stopping.state = HotspotState::Stopping;
        self.publish(stopping);

        let result = tokio::task::spawn_blocking(move || slot.worker.stop())
            .await
            .context("hotspot stop task failed")?;

        match result {
            Ok(()) => {
                let mut status = self.status();
                status.state = HotspotState::Stopped;
                status.clients = 0;
                status.devices.clear();
                status.gateway = None;
                self.publish(status);
                Ok(self.status())
            }
            Err(error) => {
                let mut status = self.status();
                status.state = HotspotState::Failed;
                status.message = Some(format!("{error:#}"));
                self.publish(status);
                Err(error)
            }
        }
    }

    fn reap_finished(&self) {
        let mut worker = self.worker.lock();
        if worker.as_ref().is_some_and(|slot| slot.worker.is_finished())
            && let Some(slot) = worker.take()
        {
            slot.worker.join();
        }
    }
}

fn status_signature(status: &HotspotStatus) -> std::string::String {
    let mut devices: Vec<&HotspotDevice> = status.devices.iter().collect();
    devices.sort_by(|left, right| left.mac.cmp(&right.mac));
    format!(
        "{:?}|{}|{}|{}|{:?}|{:?}|{:?}|{:?}",
        status.state, status.ssid, status.band, status.clients, status.gateway, status.adapter, status.message, devices
    )
}

async fn tun_device_name() -> std::string::String {
    let runtime = Config::runtime().await.latest_arc();
    runtime
        .config
        .as_ref()
        .and_then(|config| config.get("tun"))
        .and_then(|tun| tun.get("device"))
        .and_then(|device| device.as_str())
        .filter(|device| !device.is_empty())
        .unwrap_or(DEFAULT_TUN_DEVICE)
        .to_owned()
}

/// Starts the TUN-edge watcher used by the "start with TUN" preference.
#[cfg(windows)]
pub fn start_auto_watch() {
    tokio::spawn(async move {
        let manager = HotspotManager::global();
        let mut was_up = false;

        loop {
            tokio::time::sleep(STATUS_POLL).await;

            let device = tun_device_name().await;
            let up = tokio::task::spawn_blocking(move || platform::tun_adapter_up(&device))
                .await
                .unwrap_or(false);

            if up && !was_up {
                manager.manual_stop.store(false, Ordering::Release);
                let auto_start = Config::verge().await.data_arc().hotspot_auto_start.unwrap_or(false);
                if auto_start && manager.is_idle() {
                    match config_from_verge().await {
                        Ok(config) => {
                            if let Err(error) = manager.start(config).await {
                                logging_hotspot_auto_start_failure(&error);
                            }
                        }
                        Err(error) => logging_hotspot_auto_start_failure(&error),
                    }
                }
            } else if !up && was_up && !manager.is_idle() {
                let _ = manager.stop().await;
            }

            was_up = up;
        }
    });
}

#[cfg(not(windows))]
pub fn start_auto_watch() {}

#[cfg(windows)]
fn logging_hotspot_auto_start_failure(error: &anyhow::Error) {
    clash_verge_logging::logging!(
        warn,
        clash_verge_logging::Type::Core,
        "failed to start the hotspot with the TUN: {error:#}"
    );
}

#[cfg(windows)]
async fn config_from_verge() -> Result<HotspotStartConfig> {
    let verge = Config::verge().await.data_arc();
    let ssid = verge
        .hotspot_ssid
        .as_deref()
        .map(str::trim)
        .filter(|ssid| !ssid.is_empty())
        .unwrap_or(DEFAULT_SSID)
        .to_owned();
    let password = verge
        .hotspot_password
        .as_deref()
        .filter(|password| !password.is_empty())
        .context("hotspot password is not configured")?
        .to_owned();
    let band = verge.hotspot_band.as_deref().unwrap_or("auto").to_owned();
    let adapter_id = verge.hotspot_adapter_id.as_deref().map(str::to_owned);

    let config = HotspotStartConfig {
        ssid,
        password,
        band,
        adapter_id,
    };
    validate_start_config(&config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(ssid: &str, password: &str, band: &str) -> HotspotStartConfig {
        HotspotStartConfig {
            ssid: ssid.to_owned(),
            password: password.to_owned(),
            band: band.to_owned(),
            adapter_id: None,
        }
    }

    #[test]
    fn validates_hotspot_credentials() {
        assert!(validate_start_config(&config("ClashVerge", "password123", "auto")).is_ok());
        assert!(validate_start_config(&config("", "password123", "auto")).is_err());
        assert!(validate_start_config(&config("ssid", "short", "auto")).is_err());
        assert!(validate_start_config(&config("ssid", "password123", "6")).is_err());
        assert!(
            validate_start_config(&HotspotStartConfig {
                adapter_id: Some("not-a-guid".into()),
                ..config("ClashVerge", "password123", "auto")
            })
            .is_err()
        );
    }

    #[test]
    fn unchanged_status_is_published_once() {
        let status = HotspotStatus {
            state: HotspotState::Running,
            ssid: "ClashVerge".into(),
            ..HotspotStatus::default()
        };
        assert_eq!(status_signature(&status), status_signature(&status.clone()));

        let mut changed = status.clone();
        changed.clients = 1;
        assert_ne!(status_signature(&status), status_signature(&changed));
    }
}

#![cfg(not(target_os = "windows"))]

//! Stubs that keep the hotspot commands and generated bindings available on
//! every desktop target.

use super::{HotspotAdapter, HotspotStartConfig, HotspotStatus, Publisher};
use anyhow::{Result, bail};

pub(crate) struct Worker;

impl Worker {
    pub(crate) const fn is_finished(&self) -> bool {
        true
    }

    pub(crate) fn join(self) {}

    pub(crate) fn stop(self) -> Result<()> {
        Ok(())
    }
}

pub(crate) fn start_worker(
    _config: HotspotStartConfig,
    _tun_device: std::string::String,
    _publisher: Publisher,
) -> Result<(Worker, HotspotStatus)> {
    bail!("the Wi-Fi hotspot is only supported on Windows")
}

pub(crate) fn list_adapters() -> Result<Vec<HotspotAdapter>> {
    bail!("the Wi-Fi hotspot is only supported on Windows")
}

pub(crate) const fn tun_adapter_up(_device: &str) -> bool {
    false
}

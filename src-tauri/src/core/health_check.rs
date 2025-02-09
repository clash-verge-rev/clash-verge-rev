use anyhow::{bail, Result};
use sysinfo::{Pid, System};
use crate::config::Config;
use crate::core::service;
use port_scanner::local_port_available;

#[derive(Debug, Clone)]
pub struct HealthChecker;

impl HealthChecker {
    pub fn new() -> Self {
        Self
    }

    pub async fn check_ports(&self) -> Result<()> {
        let verge = Config::verge();
        let verge_config = verge.latest();
        let mixed_port = verge_config.verge_mixed_port.unwrap_or(7897);
        let socks_port = verge_config.verge_socks_port.unwrap_or(7890);
        let http_port = verge_config.verge_port.unwrap_or(7891);

        if !local_port_available(mixed_port) {
            bail!("Mixed port {} is already in use", mixed_port);
        }

        if verge_config.verge_socks_enabled.unwrap_or(true) && !local_port_available(socks_port) {
            bail!("Socks port {} is already in use", socks_port);
        }

        if verge_config.verge_http_enabled.unwrap_or(true) && !local_port_available(http_port) {
            bail!("Http port {} is already in use", http_port);
        }

        Ok(())
    }

    pub async fn check_service_health(&self) -> Result<()> {
        if let Ok(response) = service::check_service().await {
            if let Some(body) = response.data {
                let sys = System::new_all();
                if let Ok(pid) = body.bin_path.parse::<u32>() {
                    if let Some(process) = sys.process(Pid::from(pid as usize)) {
                        if !process.name().to_string_lossy().contains("mihomo") {
                            log::warn!(target: "app", "Found non-mihomo process using service port");
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
    }
} 
//! Network interface monitor for macOS
//! 
//! This module monitors the default network interface and automatically
//! re-applies system proxy settings when the interface changes.
//! This fixes the issue where macOS changes the default route when
//! switching between Wi-Fi and Ethernet, causing traffic to bypass the proxy.

use crate::{
    config::Config,
    core::sysopt::Sysopt,
    singleton,
};
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::time::interval;

/// Network monitor struct
pub struct NetworkMonitor {
    /// Last known default interface name
    last_interface: RwLock<Option<String>>,
    /// Whether monitoring is active
    is_monitoring: AtomicBool,
}

impl Default for NetworkMonitor {
    fn default() -> Self {
        Self {
            last_interface: RwLock::new(None),
            is_monitoring: AtomicBool::new(false),
        }
    }
}

singleton!(NetworkMonitor, NETWORK_MONITOR);

impl NetworkMonitor {
    fn new() -> Self {
        Self::default()
    }

    /// Get the current default network interface
    /// 
    /// On macOS, this uses the `route` command to find the interface
    /// used for the default route (0.0.0.0).
    #[cfg(target_os = "macos")]
    fn get_default_interface(&self) -> Option<String> {
        use std::process::Command;

        // Get default interface using route command
        let output = Command::new("route")
            .args(["-n", "get", "default"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        
        // Parse the output to find the interface line
        // Example output: "interface: en0"
        for line in stdout.lines() {
            let line = line.trim();
            if let Some(interface) = line.strip_prefix("interface: ") {
                return Some(interface.trim().to_string());
            }
        }

        None
    }

    /// Get the current default network interface
    /// 
    /// On Linux, check the default route.
    #[cfg(target_os = "linux")]
    fn get_default_interface(&self) -> Option<String> {
        use std::process::Command;

        // Try ip route first
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse: "default via 192.168.1.1 dev eth0 proto dhcp metric 100"
            for line in stdout.lines() {
                if let Some(idx) = line.find("dev ") {
                    let rest = &line[idx + 4..];
                    let interface = rest.split_whitespace().next()?;
                    return Some(interface.to_string());
                }
            }
        }

        // Fallback to route command
        let output = Command::new("route")
            .args(["-n"])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                // Look for line starting with 0.0.0.0 in Destination column
                if parts.len() >= 8 && parts[0] == "0.0.0.0" {
                    return Some(parts[7].to_string());
                }
            }
        }

        None
    }

    /// Get the current default network interface
    /// 
    /// On Windows, use GetBestRoute or similar.
    #[cfg(target_os = "windows")]
    fn get_default_interface(&self) -> Option<String> {
        use std::process::Command;

        // Use netsh to get the interface for default route
        let output = Command::new("netsh")
            .args(["interface", "ipv4", "show", "route"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        
        // Look for 0.0.0.0/0 route
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 5 && parts[2] == "0.0.0.0/0" {
                return Some(parts.last()?.to_string());
            }
        }

        None
    }

    /// Check if system proxy should be enabled
    async fn should_monitor(&self) -> bool {
        let verge = Config::verge().await;
        let config = verge.latest_arc();
        
        // Only monitor if system proxy is enabled
        config.enable_system_proxy.unwrap_or(false)
    }

    /// Handle interface change
    async fn on_interface_change(&self, new_interface: &str) {
        logging!(
            info,
            Type::Network,
            "Network interface changed to: {}",
            new_interface
        );

        // Update the stored interface
        *self.last_interface.write() = Some(new_interface.to_string());

        // Re-apply system proxy settings
        if self.should_monitor().await {
            logging!(
                info,
                Type::Network,
                "Re-applying system proxy settings after network change..."
            );

            if let Err(e) = Sysopt::global().update_sysproxy().await {
                logging!(
                    error,
                    Type::Network,
                    "Failed to re-apply system proxy: {}",
                    e
                );
            } else {
                logging!(
                    info,
                    Type::Network,
                    "System proxy re-applied successfully"
                );
            }
        }
    }

    /// Start monitoring network interface changes
    pub async fn start_monitoring(&self) {
        // Check if already monitoring
        if self
            .is_monitoring
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            logging!(debug, Type::Network, "Network monitor already running");
            return;
        }

        // Initialize with current interface
        if let Some(interface) = self.get_default_interface() {
            logging!(
                info,
                Type::Network,
                "Network monitor initialized with interface: {}",
                interface
            );
            *self.last_interface.write() = Some(interface);
        }

        logging!(info, Type::Network, "Starting network interface monitor");

        // Spawn monitoring task
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(3));

            loop {
                ticker.tick().await;

                // Check if we should continue monitoring
                if !Self::global().is_monitoring.load(Ordering::Relaxed) {
                    break;
                }

                // Skip if system proxy is disabled
                if !Self::global().should_monitor().await {
                    continue;
                }

                // Check for interface change
                if let Some(current) = Self::global().get_default_interface() {
                    let last = Self::global().last_interface.read().clone();
                    
                    match last {
                        Some(ref last_iface) if last_iface != &current => {
                            Self::global().on_interface_change(&current).await;
                        }
                        None => {
                            // First detection
                            *Self::global().last_interface.write() = Some(current);
                        }
                        _ => {} // No change
                    }
                }
            }

            logging!(info, Type::Network, "Network interface monitor stopped");
        });
    }

    /// Stop monitoring
    pub fn stop_monitoring(&self) {
        self.is_monitoring.store(false, Ordering::Relaxed);
        logging!(info, Type::Network, "Network monitor stop requested");
    }

    /// Refresh/restart monitoring
    pub async fn refresh(&self) {
        // Stop current monitoring
        self.stop_monitoring();
        
        // Wait a bit for the task to stop
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Reset the flag so we can start again
        self.is_monitoring.store(false, Ordering::Relaxed);
        
        // Clear last interface to force re-detection
        *self.last_interface.write() = None;
        
        // Restart if system proxy is enabled
        if self.should_monitor().await {
            self.start_monitoring().await;
        }
    }

    /// Get current interface name
    pub fn current_interface(&self) -> Option<String> {
        self.last_interface.read().clone()
    }
}

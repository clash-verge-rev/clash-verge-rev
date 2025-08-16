use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Instant};
use tokio::{sync::RwLock, time::Duration};

use crate::{
    ipc::monitor::{IpcStreamMonitor, MonitorData, StreamingParser},
    singleton_lazy_with_logging,
    utils::format::fmt_bytes,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrafficData {
    pub up: u64,
    pub down: u64,
}

#[derive(Debug, Clone)]
pub struct CurrentTraffic {
    pub up_rate: u64,
    pub down_rate: u64,
    pub total_up: u64,
    pub total_down: u64,
    pub last_updated: Instant,
}

impl Default for CurrentTraffic {
    fn default() -> Self {
        Self {
            up_rate: 0,
            down_rate: 0,
            total_up: 0,
            total_down: 0,
            last_updated: Instant::now(),
        }
    }
}

impl MonitorData for CurrentTraffic {
    fn mark_fresh(&mut self) {
        self.last_updated = Instant::now();
    }

    fn is_fresh_within(&self, duration: Duration) -> bool {
        self.last_updated.elapsed() < duration
    }
}

// Traffic monitoring state for calculating rates
#[derive(Debug, Clone, Default)]
pub struct TrafficMonitorState {
    pub current: CurrentTraffic,
    pub last_traffic: Option<TrafficData>,
}

impl MonitorData for TrafficMonitorState {
    fn mark_fresh(&mut self) {
        self.current.mark_fresh();
    }

    fn is_fresh_within(&self, duration: Duration) -> bool {
        self.current.is_fresh_within(duration)
    }
}

impl StreamingParser for TrafficMonitorState {
    fn parse_and_update(
        line: &str,
        current: Arc<RwLock<Self>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Ok(traffic) = serde_json::from_str::<TrafficData>(line.trim()) {
            tokio::spawn(async move {
                let mut state_guard = current.write().await;

                let (up_rate, down_rate) = state_guard
                    .last_traffic
                    .as_ref()
                    .map(|l| {
                        (
                            traffic.up.saturating_sub(l.up),
                            traffic.down.saturating_sub(l.down),
                        )
                    })
                    .unwrap_or((0, 0));

                state_guard.current = CurrentTraffic {
                    up_rate,
                    down_rate,
                    total_up: traffic.up,
                    total_down: traffic.down,
                    last_updated: Instant::now(),
                };

                state_guard.last_traffic = Some(traffic);
            });
        }
        Ok(())
    }
}

// Minimal traffic monitor using the new architecture
pub struct TrafficMonitor {
    monitor: IpcStreamMonitor<TrafficMonitorState>,
}

impl Default for TrafficMonitor {
    fn default() -> Self {
        TrafficMonitor {
            monitor: IpcStreamMonitor::new(
                "/traffic".to_string(),
                Duration::from_secs(10),
                Duration::from_secs(1),
                Duration::from_secs(5),
            ),
        }
    }
}

// Use simplified singleton_lazy_with_logging macro
singleton_lazy_with_logging!(
    TrafficMonitor,
    INSTANCE,
    "TrafficMonitor",
    TrafficMonitor::default
);

impl TrafficMonitor {
    pub async fn current(&self) -> CurrentTraffic {
        self.monitor.current().await.current
    }

    pub async fn is_fresh(&self) -> bool {
        self.monitor.is_fresh().await
    }
}

pub async fn get_current_traffic() -> CurrentTraffic {
    TrafficMonitor::global().current().await
}

pub async fn get_formatted_traffic() -> (String, String, String, String, bool) {
    let monitor = TrafficMonitor::global();
    let traffic = monitor.current().await;
    let is_fresh = monitor.is_fresh().await;

    (
        fmt_bytes(traffic.up_rate),
        fmt_bytes(traffic.down_rate),
        fmt_bytes(traffic.total_up),
        fmt_bytes(traffic.total_down),
        is_fresh,
    )
}

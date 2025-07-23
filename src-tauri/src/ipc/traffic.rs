use kode_bridge::IpcStreamClient;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, OnceLock},
    time::Instant,
};
use tokio::{sync::RwLock, time::Duration};

use crate::{
    logging,
    utils::{dirs::ipc_path, logging::Type},
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

// Minimal traffic monitor
pub struct TrafficMonitor {
    current: Arc<RwLock<CurrentTraffic>>,
}

static INSTANCE: OnceLock<TrafficMonitor> = OnceLock::new();

impl TrafficMonitor {
    pub fn global() -> &'static TrafficMonitor {
        INSTANCE.get_or_init(|| {
            let ipc_path_buf = ipc_path().unwrap();
            let ipc_path = ipc_path_buf.to_str().unwrap_or_default();
            let client = IpcStreamClient::new(ipc_path).unwrap();

            let instance = TrafficMonitor::new(client);
            logging!(
                info,
                Type::Ipc,
                true,
                "TrafficMonitor initialized with IPC path: {}",
                ipc_path
            );
            instance
        })
    }

    fn new(client: IpcStreamClient) -> Self {
        let current = Arc::new(RwLock::new(CurrentTraffic::default()));
        let monitor_current = current.clone();

        tokio::spawn(async move {
            let mut last: Option<TrafficData> = None;
            loop {
                let _ = client
                    .get("/traffic")
                    .timeout(Duration::from_secs(10))
                    .process_lines(|line| {
                        if let Ok(traffic) = serde_json::from_str::<TrafficData>(line.trim()) {
                            let (up_rate, down_rate) = last
                                .as_ref()
                                .map(|l| {
                                    (
                                        traffic.up.saturating_sub(l.up),
                                        traffic.down.saturating_sub(l.down),
                                    )
                                })
                                .unwrap_or((0, 0));

                            tokio::spawn({
                                let current = monitor_current.clone();
                                async move {
                                    *current.write().await = CurrentTraffic {
                                        up_rate,
                                        down_rate,
                                        total_up: traffic.up,
                                        total_down: traffic.down,
                                        last_updated: Instant::now(),
                                    };
                                }
                            });
                            last = Some(traffic);
                        }
                        Ok(())
                    })
                    .await;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });

        Self { current }
    }

    pub async fn current(&self) -> CurrentTraffic {
        self.current.read().await.clone()
    }

    pub async fn is_fresh(&self) -> bool {
        self.current.read().await.last_updated.elapsed() < Duration::from_secs(5)
    }
}

fn fmt_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let (mut val, mut unit) = (bytes as f64, 0);
    while val >= 1024.0 && unit < 3 {
        val /= 1024.0;
        unit += 1;
    }
    format!("{:.1}{}", val, UNITS[unit])
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

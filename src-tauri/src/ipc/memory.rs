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
pub struct MemoryData {
    pub inuse: u64,
    pub oslimit: u64,
}

#[derive(Debug, Clone)]
pub struct CurrentMemory {
    pub inuse: u64,
    pub oslimit: u64,
    pub last_updated: Instant,
}

impl Default for CurrentMemory {
    fn default() -> Self {
        Self {
            inuse: 0,
            oslimit: 0,
            last_updated: Instant::now(),
        }
    }
}

// Minimal memory monitor
pub struct MemoryMonitor {
    current: Arc<RwLock<CurrentMemory>>,
}

static INSTANCE: OnceLock<MemoryMonitor> = OnceLock::new();

impl MemoryMonitor {
    pub fn global() -> &'static MemoryMonitor {
        INSTANCE.get_or_init(|| {
            let ipc_path_buf = ipc_path().unwrap();
            let ipc_path = ipc_path_buf.to_str().unwrap_or_default();
            let client = IpcStreamClient::new(ipc_path).unwrap();

            let instance = MemoryMonitor::new(client);
            logging!(
                info,
                Type::Ipc,
                true,
                "MemoryMonitor initialized with IPC path: {}",
                ipc_path
            );
            instance
        })
    }

    fn new(client: IpcStreamClient) -> Self {
        let current = Arc::new(RwLock::new(CurrentMemory::default()));
        let monitor_current = current.clone();

        tokio::spawn(async move {
            loop {
                let _ = client
                    .get("/memory")
                    .timeout(Duration::from_secs(10))
                    .process_lines(|line| {
                        if let Ok(memory) = serde_json::from_str::<MemoryData>(line.trim()) {
                            tokio::spawn({
                                let current = monitor_current.clone();
                                async move {
                                    *current.write().await = CurrentMemory {
                                        inuse: memory.inuse,
                                        oslimit: memory.oslimit,
                                        last_updated: Instant::now(),
                                    };
                                }
                            });
                        }
                        Ok(())
                    })
                    .await;
                tokio::time::sleep(Duration::from_secs(2)).await; // Memory updates less frequently
            }
        });

        Self { current }
    }

    pub async fn current(&self) -> CurrentMemory {
        self.current.read().await.clone()
    }

    pub async fn is_fresh(&self) -> bool {
        self.current.read().await.last_updated.elapsed() < Duration::from_secs(10)
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

pub async fn get_current_memory() -> CurrentMemory {
    MemoryMonitor::global().current().await
}

pub async fn get_formatted_memory() -> (String, String, f64, bool) {
    let monitor = MemoryMonitor::global();
    let memory = monitor.current().await;
    let is_fresh = monitor.is_fresh().await;

    let usage_percent = if memory.oslimit > 0 {
        (memory.inuse as f64 / memory.oslimit as f64) * 100.0
    } else {
        0.0
    };

    (
        fmt_bytes(memory.inuse),
        fmt_bytes(memory.oslimit),
        usage_percent,
        is_fresh,
    )
}

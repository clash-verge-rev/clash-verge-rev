use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Instant};
use tokio::{sync::RwLock, time::Duration};

use crate::{
    ipc::monitor::{IpcStreamMonitor, MonitorData, StreamingParser},
    singleton_lazy_with_logging,
    utils::format::fmt_bytes,
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

impl MonitorData for CurrentMemory {
    fn mark_fresh(&mut self) {
        self.last_updated = Instant::now();
    }

    fn is_fresh_within(&self, duration: Duration) -> bool {
        self.last_updated.elapsed() < duration
    }
}

impl StreamingParser for CurrentMemory {
    fn parse_and_update(
        line: &str,
        current: Arc<RwLock<Self>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Ok(memory) = serde_json::from_str::<MemoryData>(line.trim()) {
            tokio::spawn(async move {
                let mut current_guard = current.write().await;
                current_guard.inuse = memory.inuse;
                current_guard.oslimit = memory.oslimit;
                current_guard.mark_fresh();
            });
        }
        Ok(())
    }
}

// Minimal memory monitor using the new architecture
pub struct MemoryMonitor {
    monitor: IpcStreamMonitor<CurrentMemory>,
}

impl Default for MemoryMonitor {
    fn default() -> Self {
        MemoryMonitor {
            monitor: IpcStreamMonitor::new(
                "/memory".to_string(),
                Duration::from_secs(10),
                Duration::from_secs(2),
                Duration::from_secs(10),
            ),
        }
    }
}

// Use simplified singleton_lazy_with_logging macro
singleton_lazy_with_logging!(
    MemoryMonitor,
    INSTANCE,
    "MemoryMonitor",
    MemoryMonitor::default
);

impl MemoryMonitor {
    pub async fn current(&self) -> CurrentMemory {
        self.monitor.current().await
    }

    pub async fn is_fresh(&self) -> bool {
        self.monitor.is_fresh().await
    }
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

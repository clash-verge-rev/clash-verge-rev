use kode_bridge::IpcStreamClient;
use std::sync::Arc;
use tokio::{sync::RwLock, time::Duration};

use crate::{
    logging,
    utils::{dirs::ipc_path, logging::Type},
};

/// Generic base structure for IPC monitoring data with freshness tracking
pub trait MonitorData: Clone + Send + Sync + 'static {
    /// Update the last_updated timestamp to now
    fn mark_fresh(&mut self);

    /// Check if data is fresh based on the given duration
    fn is_fresh_within(&self, duration: Duration) -> bool;
}

/// Trait for parsing streaming data and updating monitor state
pub trait StreamingParser: MonitorData {
    /// Parse a line of streaming data and update the current state
    fn parse_and_update(
        line: &str,
        current: Arc<RwLock<Self>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;
}

/// Generic IPC stream monitor that handles the common streaming pattern
pub struct IpcStreamMonitor<T>
where
    T: MonitorData + StreamingParser + Default,
{
    current: Arc<RwLock<T>>,
    #[allow(dead_code)]
    endpoint: String,
    #[allow(dead_code)]
    timeout: Duration,
    #[allow(dead_code)]
    retry_interval: Duration,
    freshness_duration: Duration,
}

impl<T> IpcStreamMonitor<T>
where
    T: MonitorData + StreamingParser + Default,
{
    pub fn new(
        endpoint: String,
        timeout: Duration,
        retry_interval: Duration,
        freshness_duration: Duration,
    ) -> Self {
        let current = Arc::new(RwLock::new(T::default()));
        let monitor_current = current.clone();
        let endpoint_clone = endpoint.clone();

        // Start the monitoring task
        tokio::spawn(async move {
            Self::streaming_task(monitor_current, endpoint_clone, timeout, retry_interval).await;
        });

        Self {
            current,
            endpoint,
            timeout,
            retry_interval,
            freshness_duration,
        }
    }

    pub async fn current(&self) -> T {
        self.current.read().await.clone()
    }

    pub async fn is_fresh(&self) -> bool {
        self.current
            .read()
            .await
            .is_fresh_within(self.freshness_duration)
    }

    /// The core streaming task that can be specialized per monitor type
    async fn streaming_task(
        current: Arc<RwLock<T>>,
        endpoint: String,
        timeout: Duration,
        retry_interval: Duration,
    ) {
        loop {
            let ipc_path_buf = match ipc_path() {
                Ok(path) => path,
                Err(e) => {
                    logging!(error, Type::Ipc, true, "Failed to get IPC path: {}", e);
                    tokio::time::sleep(retry_interval).await;
                    continue;
                }
            };

            let ipc_path = ipc_path_buf.to_str().unwrap_or_default();

            let client = match IpcStreamClient::new(ipc_path) {
                Ok(client) => client,
                Err(e) => {
                    logging!(error, Type::Ipc, true, "Failed to create IPC client: {}", e);
                    tokio::time::sleep(retry_interval).await;
                    continue;
                }
            };

            let _ = client
                .get(&endpoint)
                .timeout(timeout)
                .process_lines(|line| T::parse_and_update(line, current.clone()))
                .await;

            tokio::time::sleep(retry_interval).await;
        }
    }
}

use anyhow::Result;
use kode_bridge::IpcStreamClient;
use std::sync::Arc;
use tokio::{sync::RwLock, time::Duration};

use crate::{
    config::Config, ipc::IpcManager, logging, process::AsyncHandler, utils::logging::Type,
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
        let monitor_current = Arc::clone(&current);
        let endpoint_clone = endpoint.clone();

        // Start the monitoring task
        AsyncHandler::spawn(move || async move {
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

    async fn create_ipc_client() -> Result<IpcStreamClient> {
        let current_ipc_path = Config::clash()
            .await
            .latest_ref()
            .get_external_controller_ipc();
        logging!(
            info,
            Type::Ipc,
            true,
            "Using IPC path: {}",
            current_ipc_path
        );
        let client = IpcStreamClient::new(&current_ipc_path)?;
        Ok(client)
    }

    /// The core streaming task that can be specialized per monitor type
    async fn streaming_task(
        current: Arc<RwLock<T>>,
        endpoint: String,
        timeout: Duration,
        retry_interval: Duration,
    ) {
        loop {
            let client = match Self::create_ipc_client().await {
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
                .process_lines(|line| T::parse_and_update(line, Arc::clone(&current)))
                .await;

            tokio::time::sleep(retry_interval).await;
        }
    }
}

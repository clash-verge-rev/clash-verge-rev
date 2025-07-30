use kode_bridge::IpcStreamClient;
use std::sync::Arc;
use tokio::{sync::RwLock, task::JoinHandle, time::Duration};

use crate::{
    logging,
    utils::{dirs::ipc_path, logging::Type},
};

/// Generic trait for IPC stream monitoring
#[allow(dead_code)]
pub trait IpcStreamMonitor<T>
where
    T: Clone + Send + Sync + 'static,
{
    /// Get the current data
    async fn current(&self) -> T;

    /// Check if data is fresh (recently updated)
    async fn is_fresh(&self) -> bool;

    /// Get the endpoint URL for streaming
    fn get_endpoint(&self) -> String;

    /// Process a line of streaming data
    fn process_line(
        &self,
        line: &str,
        current: Arc<RwLock<T>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>;

    /// Get timeout duration for streaming
    fn get_timeout(&self) -> Duration {
        Duration::from_secs(30)
    }

    /// Get retry interval
    fn get_retry_interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    /// Start streaming monitoring
    async fn start_streaming(
        &self,
        _current: Arc<RwLock<T>>,
        task_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    ) {
        // Stop existing task if any
        {
            let mut handle = task_handle.write().await;
            if let Some(task) = handle.take() {
                task.abort();
                logging!(info, Type::Ipc, true, "Stopped previous streaming task");
            }
        }

        let endpoint = self.get_endpoint();
        let endpoint_for_log = endpoint.clone(); // Clone for logging
        let timeout = self.get_timeout();
        let retry_interval = self.get_retry_interval();

        // Create new streaming task
        let task = tokio::spawn(async move {
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

                logging!(info, Type::Ipc, true, "Starting stream for {}", endpoint);

                let _ = client
                    .get(&endpoint)
                    .timeout(timeout)
                    .process_lines(|_line| {
                        // Note: This is a simplified version - actual implementation would need
                        // access to self for process_line, which requires more complex design
                        // This demonstrates the pattern but would need trait object or other approach
                        Ok(())
                    })
                    .await;

                // Wait before retrying
                tokio::time::sleep(retry_interval).await;
            }
        });

        // Store the task handle
        {
            let mut handle = task_handle.write().await;
            *handle = Some(task);
        }

        logging!(
            info,
            Type::Ipc,
            true,
            "Started new streaming task for {}",
            endpoint_for_log
        );
    }
}

/// Generic singleton pattern for IPC monitors
#[allow(dead_code)]
pub struct IpcMonitorManager<T> {
    current: Arc<RwLock<T>>,
    task_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
}

#[allow(dead_code)]
impl<T> IpcMonitorManager<T>
where
    T: Clone + Send + Sync + 'static,
{
    pub fn new(initial_data: T) -> Self {
        Self {
            current: Arc::new(RwLock::new(initial_data)),
            task_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn current(&self) -> T {
        self.current.read().await.clone()
    }

    pub fn get_current_ref(&self) -> Arc<RwLock<T>> {
        self.current.clone()
    }

    pub fn get_task_handle_ref(&self) -> Arc<RwLock<Option<JoinHandle<()>>>> {
        self.task_handle.clone()
    }
}

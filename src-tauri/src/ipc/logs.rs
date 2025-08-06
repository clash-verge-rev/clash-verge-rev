use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Arc, time::Instant};
use tokio::{sync::RwLock, task::JoinHandle, time::Duration};

use crate::{
    ipc::monitor::MonitorData,
    logging, singleton_with_logging,
    utils::{dirs::ipc_path, logging::Type},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LogData {
    #[serde(rename = "type")]
    pub log_type: String,
    pub payload: String,
}

#[derive(Debug, Clone)]
pub struct LogItem {
    pub log_type: String,
    pub payload: String,
    pub time: String,
}

impl LogItem {
    fn new(log_type: String, payload: String) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Simple time formatting (HH:MM:SS)
        let hours = (now / 3600) % 24;
        let minutes = (now / 60) % 60;
        let seconds = now % 60;
        let time_str = format!("{hours:02}:{minutes:02}:{seconds:02}");

        Self {
            log_type,
            payload,
            time: time_str,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CurrentLogs {
    pub logs: VecDeque<LogItem>,
    pub level: String,
    pub last_updated: Instant,
}

impl Default for CurrentLogs {
    fn default() -> Self {
        Self {
            logs: VecDeque::with_capacity(1000),
            level: "info".to_string(),
            last_updated: Instant::now(),
        }
    }
}

impl MonitorData for CurrentLogs {
    fn mark_fresh(&mut self) {
        self.last_updated = Instant::now();
    }

    fn is_fresh_within(&self, duration: Duration) -> bool {
        self.last_updated.elapsed() < duration
    }
}

// Logs monitor with streaming support
pub struct LogsMonitor {
    current: Arc<RwLock<CurrentLogs>>,
    task_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    current_monitoring_level: Arc<RwLock<Option<String>>>,
}

// Use singleton_with_logging macro
singleton_with_logging!(LogsMonitor, INSTANCE, "LogsMonitor");

impl LogsMonitor {
    fn new() -> Self {
        let current = Arc::new(RwLock::new(CurrentLogs::default()));

        Self {
            current,
            task_handle: Arc::new(RwLock::new(None)),
            current_monitoring_level: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn start_monitoring(&self, level: Option<String>) {
        let filter_level = level.clone().unwrap_or_else(|| "info".to_string());

        // Check if we're already monitoring the same level
        {
            let current_level = self.current_monitoring_level.read().await;
            if let Some(existing_level) = current_level.as_ref() {
                if existing_level == &filter_level {
                    logging!(
                        info,
                        Type::Ipc,
                        true,
                        "LogsMonitor: Already monitoring level '{}', skipping duplicate request",
                        filter_level
                    );
                    return;
                }
            }
        }

        // Stop existing monitoring task if level changed or first time
        {
            let mut handle = self.task_handle.write().await;
            if let Some(task) = handle.take() {
                task.abort();
                logging!(
                    info,
                    Type::Ipc,
                    true,
                    "LogsMonitor: Stopped previous monitoring task (level changed)"
                );
            }
        }

        // Update current monitoring level
        {
            let mut current_level = self.current_monitoring_level.write().await;
            *current_level = Some(filter_level.clone());
        }

        let monitor_current = self.current.clone();

        // Update current level in data structure
        {
            let mut current = monitor_current.write().await;
            current.level = filter_level.clone();
        }

        let task = tokio::spawn(async move {
            loop {
                // Get fresh IPC path and client for each connection attempt
                let (_ipc_path_buf, client) = match Self::create_ipc_client().await {
                    Ok((path, client)) => (path, client),
                    Err(e) => {
                        logging!(error, Type::Ipc, true, "Failed to create IPC client: {}", e);
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        continue;
                    }
                };

                let url = "/logs";

                logging!(
                    info,
                    Type::Ipc,
                    true,
                    "LogsMonitor: Starting stream for {}",
                    url
                );

                let _ = client
                    .get(url)
                    .timeout(Duration::from_secs(30))
                    .process_lines(|line| {
                        Self::process_log_line(line, &filter_level, monitor_current.clone())
                    })
                    .await;

                // Wait before retrying
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });

        // Store the task handle
        {
            let mut handle = self.task_handle.write().await;
            *handle = Some(task);
        }

        logging!(
            info,
            Type::Ipc,
            true,
            "LogsMonitor: Started new monitoring task for level: {:?}",
            level
        );
    }

    pub async fn stop_monitoring(&self) {
        // Stop monitoring task but keep logs
        {
            let mut handle = self.task_handle.write().await;
            if let Some(task) = handle.take() {
                task.abort();
                logging!(
                    info,
                    Type::Ipc,
                    true,
                    "LogsMonitor: Stopped monitoring task"
                );
            }
        }

        // Reset monitoring level
        {
            let mut monitoring_level = self.current_monitoring_level.write().await;
            *monitoring_level = None;
        }
    }

    async fn create_ipc_client() -> Result<
        (std::path::PathBuf, kode_bridge::IpcStreamClient),
        Box<dyn std::error::Error + Send + Sync>,
    > {
        use kode_bridge::IpcStreamClient;

        let ipc_path_buf = ipc_path()?;
        let ipc_path = ipc_path_buf.to_str().ok_or("Invalid IPC path")?;
        let client = IpcStreamClient::new(ipc_path)?;
        Ok((ipc_path_buf, client))
    }

    fn process_log_line(
        line: &str,
        filter_level: &str,
        current: Arc<RwLock<CurrentLogs>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Ok(log_data) = serde_json::from_str::<LogData>(line.trim()) {
            // Filter logs based on level if needed
            let should_include = match filter_level {
                "all" => true,
                "debug" => true, // DEBUG level should include all log types
                "info" => {
                    let log_type = log_data.log_type.to_lowercase();
                    matches!(log_type.as_str(), "info" | "warning" | "error")
                }
                "warning" => {
                    let log_type = log_data.log_type.to_lowercase();
                    matches!(log_type.as_str(), "warning" | "error")
                }
                "error" => {
                    let log_type = log_data.log_type.to_lowercase();
                    log_type == "error"
                }
                level => log_data.log_type.to_lowercase() == level.to_lowercase(),
            };

            if should_include {
                let log_item = LogItem::new(log_data.log_type, log_data.payload);

                tokio::spawn(async move {
                    let mut logs = current.write().await;

                    // Add new log
                    logs.logs.push_back(log_item);

                    // Keep only the last 1000 logs
                    if logs.logs.len() > 1000 {
                        logs.logs.pop_front();
                    }

                    logs.mark_fresh();
                });
            }
        }
        Ok(())
    }

    pub async fn current(&self) -> CurrentLogs {
        self.current.read().await.clone()
    }

    pub async fn clear_logs(&self) {
        let mut current = self.current.write().await;
        current.logs.clear();
        current.mark_fresh();
        logging!(
            info,
            Type::Ipc,
            true,
            "LogsMonitor: Cleared frontend logs (monitoring continues)"
        );
    }

    pub async fn get_logs_as_json(&self, level: Option<String>) -> serde_json::Value {
        let current = self.current().await;

        let filtered_logs: Vec<serde_json::Value> = current
            .logs
            .iter()
            .filter(|log| {
                if let Some(ref filter_level) = level {
                    match filter_level.as_str() {
                        "all" => true,
                        "debug" => true, // DEBUG level should include all log types
                        "info" => {
                            let log_type = log.log_type.to_lowercase();
                            matches!(log_type.as_str(), "info" | "warning" | "error")
                        }
                        "warning" => {
                            let log_type = log.log_type.to_lowercase();
                            matches!(log_type.as_str(), "warning" | "error")
                        }
                        "error" => {
                            let log_type = log.log_type.to_lowercase();
                            log_type == "error"
                        }
                        level => log.log_type.to_lowercase() == level.to_lowercase(),
                    }
                } else {
                    true
                }
            })
            .map(|log| {
                serde_json::json!({
                    "type": log.log_type,
                    "payload": log.payload,
                    "time": log.time
                })
            })
            .collect();

        serde_json::Value::Array(filtered_logs)
    }
}

pub async fn start_logs_monitoring(level: Option<String>) {
    LogsMonitor::global().start_monitoring(level).await;
}

pub async fn stop_logs_monitoring() {
    LogsMonitor::global().stop_monitoring().await;
}

pub async fn clear_logs() {
    LogsMonitor::global().clear_logs().await;
}

pub async fn get_logs_json(level: Option<String>) -> serde_json::Value {
    LogsMonitor::global().get_logs_as_json(level).await
}

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use parking_lot::RwLock;
use tokio::sync::watch;

use super::batcher::RecordBatcher;
use super::monitor::ConnectionMonitor;
use super::store::SQLiteStore;
use super::types::{TrafficAggregate, TrafficQueryParams, TrafficSummary};
use crate::process::AsyncHandler;
use crate::singleton;
use crate::utils::dirs;
use clash_verge_logging::{Type, logging};

/// Upper bound for the graceful shutdown drain.
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
/// Bounded queue between the monitor (async) and the batcher thread.
const RECORD_CHANNEL_CAPACITY: usize = 4096;

/// Owns the traffic stats database and the background collector task.
pub struct TrafficStatsManager {
    store: RwLock<Option<Arc<SQLiteStore>>>,
    shutdown_tx: RwLock<Option<watch::Sender<bool>>>,
    task_handle: RwLock<Option<tauri::async_runtime::JoinHandle<()>>>,
    batcher_handle: RwLock<Option<std::thread::JoinHandle<()>>>,
}

singleton!(TrafficStatsManager, TRAFFIC_STATS_MANAGER);

impl TrafficStatsManager {
    const fn new() -> Self {
        Self {
            store: RwLock::new(None),
            shutdown_tx: RwLock::new(None),
            task_handle: RwLock::new(None),
            batcher_handle: RwLock::new(None),
        }
    }

    /// Opens the database and starts the background collector.
    pub async fn init(&self) -> Result<()> {
        if self.store.read().is_some() {
            return Ok(());
        }

        let db_path = dirs::app_home_dir()?.join("traffic_stats.db");
        logging!(debug, Type::System, "Traffic stats database: {:?}", db_path);

        let store = AsyncHandler::spawn_blocking(move || -> Result<SQLiteStore> {
            let store = SQLiteStore::new(db_path)?;
            store.enforce_limits()?;
            Ok(store)
        })
        .await
        .map_err(|e| anyhow::anyhow!("traffic stats init task failed: {e}"))??;
        let store = Arc::new(store);

        let (record_tx, record_rx) = std::sync::mpsc::sync_channel(RECORD_CHANNEL_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let batcher = RecordBatcher::new(Arc::clone(&store));
        *self.batcher_handle.write() = Some(batcher.spawn(record_rx));

        let task = AsyncHandler::spawn(move || async move {
            let mut monitor = ConnectionMonitor::new(record_tx, shutdown_rx);
            monitor.start().await;
        });
        *self.task_handle.write() = Some(task);
        *self.shutdown_tx.write() = Some(shutdown_tx);
        *self.store.write() = Some(store);

        logging!(info, Type::System, "Traffic stats manager started");
        Ok(())
    }

    /// Stops the collector and flushes everything buffered. Safe to call
    /// multiple times; no-op when not running.
    pub async fn stop(&self) {
        // NOTE: guards must be dropped before any `.await` below, otherwise
        // the whole quit future becomes non-Send.
        let shutdown_tx = self.shutdown_tx.write().take();
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(true);
        }

        let task_handle = self.task_handle.write().take();
        if let Some(handle) = task_handle
            && tokio::time::timeout(STOP_TIMEOUT, handle).await.is_err()
        {
            logging!(warn, Type::System, "Traffic stats: monitor did not stop in time");
        }

        let batcher_handle = self.batcher_handle.write().take();
        if let Some(handle) = batcher_handle {
            let join = tokio::task::spawn_blocking(move || handle.join());
            if tokio::time::timeout(STOP_TIMEOUT, join).await.is_err() {
                logging!(warn, Type::System, "Traffic stats: batcher did not flush in time");
            }
        }

        let had_store = self.store.write().take().is_some();
        if had_store {
            logging!(info, Type::System, "Traffic stats manager stopped");
        }
    }

    pub fn query_by_domain(&self, query: &TrafficQueryParams) -> Result<Vec<TrafficAggregate>> {
        match self.store.read().as_ref() {
            Some(store) => store.query_by_domain(query),
            None => Ok(Vec::new()),
        }
    }

    pub fn query_by_process(&self, query: &TrafficQueryParams) -> Result<Vec<TrafficAggregate>> {
        match self.store.read().as_ref() {
            Some(store) => store.query_by_process(query),
            None => Ok(Vec::new()),
        }
    }

    pub fn get_summary(
        &self,
        start: Option<chrono::DateTime<chrono::Utc>>,
        end: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<TrafficSummary> {
        match self.store.read().as_ref() {
            Some(store) => store.get_summary(start, end),
            None => Ok(TrafficSummary::default()),
        }
    }
}

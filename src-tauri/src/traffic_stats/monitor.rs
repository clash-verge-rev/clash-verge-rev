use anyhow::Result;
use chrono::Utc;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::SyncSender;
use std::time::Duration;
use tauri_plugin_mihomo::models::Connection;
use tokio::sync::watch;

use super::types::{ConnectionSnapshot, TrafficRecord};
use crate::core::handle::Handle;
use clash_verge_logging::{Type, logging};

/// Poll interval under normal operation.
const POLL_INTERVAL: Duration = Duration::from_millis(1000);
/// Upper bound for the retry delay while the core is unreachable.
const MAX_ERROR_BACKOFF: Duration = Duration::from_secs(10);
/// Log one warning per N dropped records so the loss stays visible.
const DROP_LOG_INTERVAL: u64 = 1000;

/// Polls the core connection list, detects closed connections by id diff and
/// emits `TrafficRecord`s on a bounded channel.
pub struct ConnectionMonitor {
    /// Latest snapshot of every active connection, keyed by connection id.
    active_connections: Mutex<HashMap<String, ConnectionSnapshot>>,
    /// Bounded channel towards the batcher thread.
    record_tx: SyncSender<TrafficRecord>,
    /// Becomes true on graceful shutdown.
    shutdown_rx: watch::Receiver<bool>,
    /// Records dropped so far (channel full or already disconnected).
    dropped_count: AtomicU64,
}

impl ConnectionMonitor {
    pub fn new(record_tx: SyncSender<TrafficRecord>, shutdown_rx: watch::Receiver<bool>) -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            record_tx,
            shutdown_rx,
            dropped_count: AtomicU64::new(0),
        }
    }

    /// Runs the poll loop until shutdown or app exit, then flushes the
    /// still-open connections deterministically.
    pub async fn start(&mut self) {
        logging!(info, Type::System, "Traffic stats monitor started");

        let mut in_error = false;
        let mut backoff = POLL_INTERVAL;

        loop {
            if *self.shutdown_rx.borrow() || Handle::global().is_exiting() {
                break;
            }

            match self.fetch_connections().await {
                Ok(connections) => {
                    if in_error {
                        logging!(info, Type::System, "Traffic stats: core connection recovered");
                        in_error = false;
                    }
                    backoff = POLL_INTERVAL;
                    self.process_connections(connections);
                }
                Err(err) => {
                    // Core stopped or restarting: log the transition once and
                    // keep retrying with backoff instead of spamming per tick.
                    if !in_error {
                        logging!(
                            warn,
                            Type::System,
                            "Traffic stats: failed to fetch connections, will keep retrying: {err}"
                        );
                        in_error = true;
                    }
                    backoff = (backoff * 2).min(MAX_ERROR_BACKOFF);
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(backoff) => {}
                _ = self.shutdown_rx.changed() => break,
            }
        }

        // Deterministic flush: every connection still open becomes a record
        // with the latest known counters instead of being lost.
        self.flush_active_connections();
        logging!(info, Type::System, "Traffic stats monitor stopped");
    }

    async fn fetch_connections(&self) -> Result<Vec<Connection>> {
        let response = Handle::mihomo().get_connections().await?;
        Ok(response.connections.unwrap_or_default())
    }

    fn process_connections(&self, connections: Vec<Connection>) {
        let now = Utc::now();
        let mut active = self.active_connections.lock();

        let new_ids: HashSet<String> = connections.iter().map(|c| c.id.clone()).collect();

        let mut closed_count = 0usize;
        // Detect closed connections: ids that vanished since the last poll.
        for (id, snapshot) in active.iter() {
            if !new_ids.contains(id) {
                closed_count += 1;
                self.send_record(TrafficRecord {
                    start_time: snapshot.start_time,
                    end_time: now,
                    host: snapshot.host.clone(),
                    domain: snapshot.domain.clone(),
                    process: snapshot.process.clone(),
                    process_path: snapshot.process_path.clone(),
                    upload: snapshot.upload,
                    download: snapshot.download,
                    chains: snapshot.chains.join(" / "),
                    rule: snapshot.rule.clone(),
                    network: snapshot.network.clone(),
                    source_ip: snapshot.source_ip.clone(),
                });
            }
        }

        if closed_count > 0 {
            logging!(
                debug,
                Type::System,
                "Traffic stats: detected {} closed connections",
                closed_count
            );
        }

        // Refresh the snapshot map.
        active.retain(|id, _| new_ids.contains(id));
        for conn in connections {
            let snapshot = parse_connection(&conn);
            active.insert(conn.id, snapshot);
        }
    }

    fn flush_active_connections(&self) {
        let now = Utc::now();
        let mut active = self.active_connections.lock();

        for snapshot in active.values() {
            self.send_record(TrafficRecord {
                start_time: snapshot.start_time,
                end_time: now,
                host: snapshot.host.clone(),
                domain: snapshot.domain.clone(),
                process: snapshot.process.clone(),
                process_path: snapshot.process_path.clone(),
                upload: snapshot.upload,
                download: snapshot.download,
                chains: snapshot.chains.join(" / "),
                rule: snapshot.rule.clone(),
                network: snapshot.network.clone(),
                source_ip: snapshot.source_ip.clone(),
            });
        }

        if !active.is_empty() {
            logging!(
                info,
                Type::System,
                "Traffic stats: flushed {} open connections on exit",
                active.len()
            );
        }

        active.clear();
    }

    /// Never blocks the poll loop: count and periodically log drops instead
    /// of silently discarding records.
    fn send_record(&self, record: TrafficRecord) {
        if let Err(err) = self.record_tx.try_send(record) {
            let dropped = self.dropped_count.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped.is_multiple_of(DROP_LOG_INTERVAL) {
                logging!(
                    warn,
                    Type::System,
                    "Traffic stats: {} records dropped in total (channel full or closed), last error: {err}",
                    dropped
                );
            }
        }
    }
}

fn parse_connection(conn: &Connection) -> ConnectionSnapshot {
    let metadata = &conn.metadata;

    // Host preference: domain > destination ip > remote destination.
    let (host, domain) = if !metadata.host.is_empty() {
        (
            format!("{}:{}", metadata.host, metadata.destination_port),
            metadata.host.clone(),
        )
    } else if !metadata.destination_ip.is_empty() {
        (
            format!("{}:{}", metadata.destination_ip, metadata.destination_port),
            metadata.destination_ip.clone(),
        )
    } else if !metadata.remote_destination.is_empty() {
        (
            format!("{}:{}", metadata.remote_destination, metadata.destination_port),
            metadata.remote_destination.clone(),
        )
    } else {
        (format!("unknown:{}", metadata.destination_port), "unknown".to_string())
    };

    ConnectionSnapshot {
        host,
        domain,
        process: if metadata.process.is_empty() {
            "unknown".to_string()
        } else {
            metadata.process.clone()
        },
        process_path: if metadata.process_path.is_empty() {
            None
        } else {
            Some(metadata.process_path.clone())
        },
        upload: conn.upload,
        download: conn.download,
        start_time: chrono::DateTime::parse_from_rfc3339(&conn.start)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now()),
        chains: conn.chains.clone(),
        rule: conn.rule.clone(),
        network: format!("{:?}", metadata.network).to_lowercase(),
        source_ip: metadata.source_ip.clone(),
    }
}

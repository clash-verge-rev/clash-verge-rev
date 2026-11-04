use chrono::{DateTime, Utc};
use serde::Serialize;

/// A completed traffic record, produced when a connection closes.
#[derive(Debug, Clone)]
pub struct TrafficRecord {
    /// Connection start time (as reported by the core).
    pub start_time: DateTime<Utc>,
    /// When the connection was detected as closed.
    pub end_time: DateTime<Utc>,
    /// Target host (`domain:port` or `ip:port`).
    pub host: String,
    /// Target domain extracted from the host, used for aggregation.
    pub domain: String,
    /// Process name.
    pub process: String,
    /// Process path, when known.
    pub process_path: Option<String>,
    /// Upload bytes (cumulative counters of the connection).
    pub upload: u64,
    /// Download bytes (cumulative counters of the connection).
    pub download: u64,
    /// Proxy chain, e.g. `node-a / node-b`.
    pub chains: String,
    /// Matched rule.
    pub rule: String,
    /// Network type (tcp/udp).
    pub network: String,
    /// Source IP.
    pub source_ip: String,
}

/// In-memory snapshot of an active connection, refreshed on every poll.
#[derive(Debug, Clone)]
pub struct ConnectionSnapshot {
    pub host: String,
    pub domain: String,
    pub process: String,
    pub process_path: Option<String>,
    pub upload: u64,
    pub download: u64,
    pub start_time: DateTime<Utc>,
    pub chains: Vec<String>,
    pub rule: String,
    pub network: String,
    pub source_ip: String,
}

/// Aggregated traffic grouped by domain or process.
#[derive(Debug, Serialize, specta::Type)]
pub struct TrafficAggregate {
    /// Group key: domain or process name.
    pub key: String,
    pub total_upload: u64,
    pub total_download: u64,
    pub connection_count: u64,
    #[specta(type = String)]
    pub last_active: DateTime<Utc>,
}

/// Overview statistics for a time range.
#[derive(Debug, Default, Serialize, specta::Type)]
pub struct TrafficSummary {
    pub total_upload: u64,
    pub total_download: u64,
    pub total_connections: u64,
    pub unique_domains: u64,
    pub unique_processes: u64,
}

/// Internal query parameters; times are UTC.
#[derive(Debug, Clone)]
pub struct TrafficQueryParams {
    pub start: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub limit: i64,
}

use anyhow::Result;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rusqlite::ToSql;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::types::{TrafficAggregate, TrafficQueryParams, TrafficSummary};

/// Hard cap for db + wal files combined.
const MAX_DB_SIZE_BYTES: u64 = 100 * 1024 * 1024;
/// Records older than this are deleted (fixed retention policy).
const RETENTION_DAYS: i64 = 90;
/// Re-check the size cap every N batch inserts.
const DB_SIZE_CHECK_INTERVAL: u64 = 1000;
/// Portion of rows removed per cleanup round while over the cap.
const CLEANUP_FRACTION: f64 = 0.3;
/// Safety bound for cleanup rounds per check.
const MAX_CLEANUP_ROUNDS: u32 = 8;

pub struct SQLiteStore {
    conn: Mutex<Connection>,
    db_path: PathBuf,
    write_count: AtomicU64,
}

impl SQLiteStore {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // Wait instead of failing immediately when another process holds the lock.
        conn.busy_timeout(Duration::from_secs(5))?;
        // 16 MB page cache is plenty for a background stats database.
        conn.pragma_update(None, "cache_size", -16000)?;
        conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;

        Self::init_schema(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
            db_path,
            write_count: AtomicU64::new(0),
        })
    }

    fn init_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r"
            CREATE TABLE IF NOT EXISTS traffic_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                host TEXT NOT NULL,
                domain TEXT NOT NULL,
                process TEXT NOT NULL,
                process_path TEXT,
                upload INTEGER NOT NULL,
                download INTEGER NOT NULL,
                chains TEXT NOT NULL,
                rule TEXT NOT NULL,
                network TEXT NOT NULL,
                source_ip TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_domain ON traffic_records(domain);
            CREATE INDEX IF NOT EXISTS idx_process ON traffic_records(process);
            CREATE INDEX IF NOT EXISTS idx_end_time ON traffic_records(end_time);
            ",
        )?;
        Ok(())
    }

    /// Batch insert (synchronous; call from a blocking context).
    #[expect(clippy::significant_drop_tightening)]
    pub fn insert_batch(&self, records: &[super::types::TrafficRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        {
            let mut conn = self.conn.lock();
            let tx = conn.transaction()?;

            {
                let mut stmt = tx.prepare_cached(
                    r"
                    INSERT INTO traffic_records (
                        start_time, end_time, host, domain, process, process_path,
                        upload, download, chains, rule, network, source_ip
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                    ",
                )?;

                for record in records {
                    stmt.execute(params![
                        record.start_time.to_rfc3339(),
                        record.end_time.to_rfc3339(),
                        record.host,
                        record.domain,
                        record.process,
                        record.process_path,
                        record.upload as i64,
                        record.download as i64,
                        record.chains,
                        record.rule,
                        record.network,
                        record.source_ip,
                    ])?;
                }
            }

            tx.commit()?;
        }

        // Periodically re-apply retention + size limits. The connection guard
        // above is already released; enforce_limits takes its own lock.
        if self
            .write_count
            .fetch_add(1, Ordering::Relaxed)
            .is_multiple_of(DB_SIZE_CHECK_INTERVAL)
        {
            self.enforce_limits()?;
        }

        Ok(())
    }

    /// Applies the retention window and the size cap (db + wal combined).
    pub fn enforce_limits(&self) -> Result<()> {
        let cutoff = (Utc::now() - chrono::Duration::days(RETENTION_DAYS)).to_rfc3339();
        let expired = {
            let conn = self.conn.lock();
            conn.execute("DELETE FROM traffic_records WHERE end_time < ?1", params![cutoff])?
        };
        if expired > 0 {
            clash_verge_logging::logging!(
                info,
                clash_verge_logging::Type::System,
                "Traffic stats: deleted {} expired records (older than {} days)",
                expired,
                RETENTION_DAYS
            );
        }

        let mut rounds = 0u32;
        while self.total_size_bytes() > MAX_DB_SIZE_BYTES {
            if rounds >= MAX_CLEANUP_ROUNDS {
                clash_verge_logging::logging!(
                    warn,
                    clash_verge_logging::Type::System,
                    "Traffic stats: size cap still exceeded after {} cleanup rounds",
                    rounds
                );
                break;
            }
            let deleted = self.delete_oldest_fraction()?;
            if deleted == 0 {
                break;
            }
            self.reclaim_space()?;
            rounds += 1;
        }

        Ok(())
    }

    fn total_size_bytes(&self) -> u64 {
        let mut total = 0u64;
        for suffix in ["", "-wal", "-shm"] {
            let path: PathBuf = if suffix.is_empty() {
                self.db_path.clone()
            } else {
                PathBuf::from(format!("{}{suffix}", self.db_path.display()))
            };
            if let Ok(meta) = std::fs::metadata(&path) {
                total += meta.len();
            }
        }
        total
    }

    /// Deletes the oldest rows (by end_time) making up `CLEANUP_FRACTION` of
    /// the table. Returns the number of rows removed.
    #[expect(clippy::significant_drop_tightening)]
    fn delete_oldest_fraction(&self) -> Result<i64> {
        let (total, to_delete) = {
            let conn = self.conn.lock();
            let total: i64 = conn.query_row("SELECT COUNT(*) FROM traffic_records", [], |row| row.get(0))?;
            (total, (total as f64 * CLEANUP_FRACTION) as i64)
        };

        if to_delete <= 0 {
            return Ok(0);
        }

        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM traffic_records WHERE id IN (
                SELECT id FROM traffic_records ORDER BY end_time ASC LIMIT ?1
            )",
            params![to_delete],
        )?;
        clash_verge_logging::logging!(
            info,
            clash_verge_logging::Type::System,
            "Traffic stats: size cap reached, deleted {} of {} oldest records",
            to_delete,
            total
        );
        Ok(to_delete)
    }

    fn reclaim_space(&self) -> Result<()> {
        self.conn
            .lock()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum;")?;
        Ok(())
    }

    /// Builds a time filter that keeps the query planner on `idx_end_time`:
    /// a fixed SQL fragment per NULL-arity instead of `(?1 IS NULL OR ...)`.
    fn time_filter(start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> (String, Vec<SqlValue>) {
        match (start, end) {
            (Some(s), Some(e)) => (
                " WHERE end_time >= ? AND end_time <= ?".into(),
                vec![SqlValue::Text(s.to_rfc3339()), SqlValue::Text(e.to_rfc3339())],
            ),
            (Some(s), None) => (" WHERE end_time >= ?".into(), vec![SqlValue::Text(s.to_rfc3339())]),
            (None, Some(e)) => (" WHERE end_time <= ?".into(), vec![SqlValue::Text(e.to_rfc3339())]),
            (None, None) => (String::new(), Vec::new()),
        }
    }

    #[expect(clippy::significant_drop_tightening)]
    fn query_grouped(&self, column: &str, query: &TrafficQueryParams) -> Result<Vec<TrafficAggregate>> {
        let (filter, mut bound) = Self::time_filter(query.start, query.end);
        bound.push(SqlValue::Integer(query.limit));
        let refs: Vec<&dyn ToSql> = bound.iter().map(|v| v as &dyn ToSql).collect();

        let sql = format!(
            r"
            SELECT
                {column} as key,
                SUM(upload) as total_upload,
                SUM(download) as total_download,
                COUNT(*) as connection_count,
                MAX(end_time) as last_active
            FROM traffic_records{filter}
            GROUP BY {column}
            ORDER BY total_download DESC
            LIMIT ?
            "
        );

        let conn = self.conn.lock();
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(refs.as_slice(), |row| {
            let last_active_str: String = row.get(4)?;
            let last_active = DateTime::parse_from_rfc3339(&last_active_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            Ok(TrafficAggregate {
                key: row.get(0)?,
                total_upload: row.get::<_, i64>(1)? as u64,
                total_download: row.get::<_, i64>(2)? as u64,
                connection_count: row.get::<_, i64>(3)? as u64,
                last_active,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| anyhow::anyhow!("traffic stats query error: {e}"))
    }

    pub fn query_by_domain(&self, query: &TrafficQueryParams) -> Result<Vec<TrafficAggregate>> {
        self.query_grouped("domain", query)
    }

    pub fn query_by_process(&self, query: &TrafficQueryParams) -> Result<Vec<TrafficAggregate>> {
        self.query_grouped("process", query)
    }

    /// Single-statement overview (one scan instead of five).
    #[expect(clippy::significant_drop_tightening)]
    pub fn get_summary(&self, start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> Result<TrafficSummary> {
        let (filter, bound) = Self::time_filter(start, end);
        let refs: Vec<&dyn ToSql> = bound.iter().map(|v| v as &dyn ToSql).collect();

        let sql = format!(
            r"
            SELECT
                COALESCE(SUM(upload), 0),
                COALESCE(SUM(download), 0),
                COUNT(*),
                COUNT(DISTINCT domain),
                COUNT(DISTINCT process)
            FROM traffic_records{filter}
            "
        );

        let conn = self.conn.lock();
        let summary = conn.query_row(&sql, refs.as_slice(), |row| {
            Ok(TrafficSummary {
                total_upload: row.get::<_, i64>(0)? as u64,
                total_download: row.get::<_, i64>(1)? as u64,
                total_connections: row.get::<_, i64>(2)? as u64,
                unique_domains: row.get::<_, i64>(3)? as u64,
                unique_processes: row.get::<_, i64>(4)? as u64,
            })
        })?;

        Ok(summary)
    }
}

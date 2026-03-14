use once_cell::sync::Lazy;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{Duration, sleep};

use crate::core::handle;
use crate::process::AsyncHandler;
use crate::utils::dirs;
use clash_verge_logging::{Type, logging};

static DB_CONN: Lazy<Arc<Mutex<Option<Connection>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

#[derive(Debug, Serialize, Deserialize)]
pub struct AppTrafficStat {
    pub process_name: String,
    pub process_path: String,
    pub traffic_mode: String,
    pub upload_bytes: u64,
    pub download_bytes: u64,
}

pub async fn init_app_traffic_daemon() {
    AsyncHandler::spawn(|| async {
        if let Err(e) = setup_db().await {
            logging!(error, Type::Core, "Failed to setup app traffic DB: {}", e);
            return;
        }

        logging!(info, Type::Core, "App traffic daemon started");

        let mut last_upload: HashMap<(String, String, String), u64> = HashMap::new();
        let mut last_download: HashMap<(String, String, String), u64> = HashMap::new();

        loop {
            sleep(Duration::from_secs(5)).await;

            let mihomo = handle::Handle::mihomo().await;
            let connections = match mihomo.get_connections().await {
                Ok(c) => c,
                Err(e) => {
                    logging!(
                        trace,
                        Type::Core,
                        "App traffic daemon: failed to get connections: {}",
                        e
                    );
                    continue;
                }
            };

            let mut current_upload: HashMap<(String, String, String), u64> = HashMap::new();
            let mut current_download: HashMap<(String, String, String), u64> = HashMap::new();

            if let Some(conns) = connections.connections {
                for conn in conns {
                    let process_path = conn.metadata.process_path;
                    if process_path.is_empty() {
                        continue;
                    }

                    let mut display_name = process_path.clone();
                    if process_path.starts_with("/Applications/") && process_path.contains(".app/") {
                        if let Some(app_idx) = process_path.find(".app/") {
                            display_name = process_path[14..app_idx + 4].to_string();
                        }
                    } else if let Some(pos) = process_path.rfind('/') {
                        display_name = process_path[pos + 1..].to_string();
                    }

                    let is_direct = conn.chains.iter().any(|c| c.eq_ignore_ascii_case("direct"))
                        || conn.rule.eq_ignore_ascii_case("direct");
                    let is_reject = conn.chains.iter().any(|c| c.eq_ignore_ascii_case("reject"))
                        || conn.rule.eq_ignore_ascii_case("reject");

                    let traffic_mode = if is_direct {
                        "直连".to_string()
                    } else if is_reject {
                        "拦截".to_string()
                    } else if format!("{:?}", conn.metadata.connection_type).eq_ignore_ascii_case("tun") {
                        "TUN".to_string()
                    } else {
                        "代理".to_string()
                    };

                    let key = (display_name, traffic_mode, process_path);
                    *current_upload.entry(key.clone()).or_insert(0) += conn.upload;
                    *current_download.entry(key).or_insert(0) += conn.download;
                }

                let mut deltas = Vec::new();
                for (key, total_up) in &current_upload {
                    let prev_up = last_upload.get(key).unwrap_or(&0);
                    let delta_up = if total_up > prev_up {
                        total_up - prev_up
                    } else {
                        *total_up
                    };

                    let total_down = current_download.get(key).unwrap_or(&0);
                    let prev_down = last_download.get(key).unwrap_or(&0);
                    let delta_down = if total_down > prev_down {
                        total_down - prev_down
                    } else {
                        *total_down
                    };

                    if delta_up > 0 || delta_down > 0 {
                        deltas.push((key.0.clone(), key.1.clone(), key.2.clone(), delta_up, delta_down));
                    }
                }

                if !deltas.is_empty() {
                    if let Err(e) = insert_traffic_deltas(&deltas).await {
                        logging!(error, Type::Core, "Failed to insert traffic: {}", e);
                    }
                }
            }

            last_upload = current_upload;
            last_download = current_download;
        }
    });
}

async fn setup_db() -> anyhow::Result<()> {
    let mut path = dirs::app_home_dir()?;
    path.push("app_traffic.db");

    let conn = Connection::open(&path)?;

    // Add columns dynamically for previously created databases
    let _ = conn.execute("ALTER TABLE app_traffic ADD COLUMN process_path TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE app_traffic ADD COLUMN traffic_mode TEXT DEFAULT ''", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_traffic (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            process_name TEXT NOT NULL,
            process_path TEXT DEFAULT '',
            traffic_mode TEXT DEFAULT '',
            upload_bytes INTEGER NOT NULL,
            download_bytes INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_timestamp ON app_traffic (timestamp)",
        [],
    )?;

    let mut db_guard = DB_CONN.lock().await;
    *db_guard = Some(conn);

    Ok(())
}

async fn insert_traffic_deltas(deltas: &[(String, String, String, u64, u64)]) -> anyhow::Result<()> {
    let mut db_guard = DB_CONN.lock().await;
    if let Some(conn) = db_guard.as_mut() {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO app_traffic (process_name, traffic_mode, process_path, upload_bytes, download_bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for (process_name, traffic_mode, process_path, up, down) in deltas {
                stmt.execute(params![
                    process_name,
                    traffic_mode,
                    process_path,
                    *up as i64,
                    *down as i64
                ])?;
            }
        }
        tx.commit()?;
    }
    Ok(())
}

pub async fn query_traffic(period: &str) -> anyhow::Result<Vec<AppTrafficStat>> {
    let mut db_guard = DB_CONN.lock().await;
    if let Some(conn) = db_guard.as_mut() {
        let modifier = match period {
            "day" => "'-1 day'",
            "week" => "'-7 days'",
            "month" => "'-1 month'",
            _ => "'-1 day'",
        };

        let query = format!(
            "SELECT process_name, process_path, traffic_mode, SUM(upload_bytes), SUM(download_bytes) 
             FROM app_traffic 
             WHERE timestamp >= datetime('now', {})
             GROUP BY process_name, process_path, traffic_mode 
             ORDER BY SUM(download_bytes) DESC",
            modifier
        );

        let mut stmt = conn.prepare(&query)?;
        let rows = stmt.query_map([], |row| {
            let up: i64 = row.get(3)?;
            let down: i64 = row.get(4)?;
            Ok(AppTrafficStat {
                process_name: row.get(0)?,
                process_path: row.get(1)?,
                traffic_mode: row.get(2)?,
                upload_bytes: up as u64,
                download_bytes: down as u64,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        return Ok(results);
    }
    Ok(vec![])
}

pub async fn clear_traffic() -> anyhow::Result<()> {
    let mut db_guard = DB_CONN.lock().await;
    if let Some(conn) = db_guard.as_mut() {
        conn.execute("DELETE FROM app_traffic", [])?;
    }
    Ok(())
}

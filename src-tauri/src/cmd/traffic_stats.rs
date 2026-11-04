use chrono::{DateTime, Utc};

use crate::cmd::{CmdResult, CommandFailure};
use crate::traffic_stats::{TrafficAggregate, TrafficQueryParams, TrafficStatsManager, TrafficSummary};

fn parse_rfc3339(value: Option<String>) -> Option<DateTime<Utc>> {
    value
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&Utc))
}

/// Aggregate traffic records grouped by domain or process.
#[tauri::command]
#[specta::specta]
pub async fn query_traffic_stats(
    start: Option<String>,
    end: Option<String>,
    group_by: String,
    limit: Option<i64>,
) -> CmdResult<Vec<TrafficAggregate>> {
    if group_by != "domain" && group_by != "process" {
        return Err(CommandFailure::plain(format!("invalid group_by: {group_by}")));
    }

    let query = TrafficQueryParams {
        start: parse_rfc3339(start),
        end: parse_rfc3339(end),
        limit: limit.unwrap_or(100).clamp(1, 1000),
    };

    tokio::task::spawn_blocking(move || {
        let manager = TrafficStatsManager::global();
        if group_by == "domain" {
            manager.query_by_domain(&query)
        } else {
            manager.query_by_process(&query)
        }
    })
    .await
    .map_err(|e| CommandFailure::plain(e.to_string()))?
    .map_err(|e| CommandFailure::plain(format!("{e:#}")))
}

/// Overview totals for a time range.
#[tauri::command]
#[specta::specta]
pub async fn get_traffic_summary(start: Option<String>, end: Option<String>) -> CmdResult<TrafficSummary> {
    let start = parse_rfc3339(start);
    let end = parse_rfc3339(end);

    tokio::task::spawn_blocking(move || TrafficStatsManager::global().get_summary(start, end))
        .await
        .map_err(|e| CommandFailure::plain(e.to_string()))?
        .map_err(|e| CommandFailure::plain(format!("{e:#}")))
}

use crate::cmd::CmdResult;
use crate::cmd::StringifyErr as _;
use crate::feat::app_traffic::{AppTrafficStat, clear_traffic, query_traffic};

#[tauri::command]
pub async fn get_app_traffic_stats(period: String) -> CmdResult<Vec<AppTrafficStat>> {
    query_traffic(&period).await.stringify_err()
}

#[tauri::command]
pub async fn clear_app_traffic_stats() -> CmdResult<()> {
    clear_traffic().await.stringify_err()
}

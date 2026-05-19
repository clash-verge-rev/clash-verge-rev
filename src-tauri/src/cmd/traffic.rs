use std::fs;
use tauri::AppHandle;
use tauri::Manager as _;

use super::CmdResult;
use super::StringifyErr as _;

/// 从磁盘加载今日流量记录
#[tauri::command]
pub fn load_daily_traffic(app: AppHandle) -> CmdResult<Option<String>> {
    let dir = app.path().app_data_dir().stringify_err()?;
    let path = dir.join("daily_traffic.json");
    if path.exists() {
        fs::read_to_string(&path).stringify_err().map(Some)
    } else {
        Ok(None)
    }
}

/// 保存今日流量记录到磁盘
#[tauri::command]
pub fn save_daily_traffic(app: AppHandle, data: String) -> CmdResult<()> {
    let dir = app.path().app_data_dir().stringify_err()?;
    fs::create_dir_all(&dir).stringify_err()?;
    let path = dir.join("daily_traffic.json");
    fs::write(&path, &data).stringify_err()
}

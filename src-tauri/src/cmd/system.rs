use std::sync::Arc;

use crate::core::{CoreManager, manager::RunningMode};

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> Result<Arc<RunningMode>, String> {
    Ok(CoreManager::global().get_running_mode())
}

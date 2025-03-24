use super::CmdResult;
use crate::{core::CoreManager, wrap_err};

/// 修复系统服务
#[tauri::command]
pub async fn repair_service() -> CmdResult {
    wrap_err!(CoreManager::global().repair_service().await)
} 
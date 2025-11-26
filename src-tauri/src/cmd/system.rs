use std::sync::Arc;

use crate::{
    cmd::{CmdResult, StringifyErr as _},
    core::{CoreManager, manager::RunningMode},
    utils::ntp,
};

/// 获取当前内核运行模式
#[tauri::command]
pub async fn get_running_mode() -> CmdResult<Arc<RunningMode>> {
    Ok(CoreManager::global().get_running_mode())
}

/// 检查系统 NTP 状态
#[tauri::command]
pub async fn check_ntp_status() -> CmdResult<ntp::NtpStatus> {
    ntp::check_ntp_status().await.stringify_err()
}

/// 立即同步一次 NTP
#[tauri::command]
pub async fn sync_ntp_now() -> CmdResult<bool> {
    ntp::sync_ntp_once().await.stringify_err().map(|_| true)
}

/// 尝试应用推荐的 NTP 服务器
#[tauri::command]
pub async fn apply_recommended_ntp_server() -> CmdResult<ntp::NtpStatus> {
    ntp::apply_recommended_ntp().await.stringify_err()
}

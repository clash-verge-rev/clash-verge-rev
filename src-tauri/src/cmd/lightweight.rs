use crate::core::lightweight;

use super::CmdResult;

#[tauri::command]
#[specta::specta]
pub async fn entry_lightweight_mode() -> CmdResult {
    lightweight::entry_lightweight_mode().await;
    Ok(())
}

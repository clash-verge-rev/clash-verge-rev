use crate::module::lightweight;

use super::CmdResult;

#[tauri::command]
pub async fn entry_lightweight_mode() -> CmdResult {
    lightweight::entry_lightweight_mode();
    Ok(())
}

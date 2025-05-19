use crate::core::tray::Tray;
use crate::module::lightweight;

use super::CmdResult;

#[tauri::command]
pub async fn entry_lightweight_mode() -> CmdResult {
    lightweight::entry_lightweight_mode();

    if let Err(e) = Tray::global().update_menu() {
        log::warn!(target: "app", "Failed to update tray menu after entry_lightweight_mode (cmd): {}", e);
    }

    Ok(())
}

#[tauri::command]
pub async fn exit_lightweight_mode() -> CmdResult {
    lightweight::exit_lightweight_mode();
    Ok(())
}

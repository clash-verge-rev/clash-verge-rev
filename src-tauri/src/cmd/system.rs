use super::CmdResult;
use crate::{core::handle, model::sysinfo::PlatformSpecification};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub async fn export_diagnostic_info() -> CmdResult<()> {
    let sysinfo = PlatformSpecification::new();
    let info = format!("{:?}", sysinfo);

    let app_handle = handle::Handle::global().app_handle().unwrap();
    let cliboard = app_handle.clipboard();
    
    if let Err(_) = cliboard.write_text(info) {
        log::error!(target: "app", "Failed to write to clipboard");
    }
    Ok(())
}

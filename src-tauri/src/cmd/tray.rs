use crate::cmd::CmdResult;

#[tauri::command]
pub async fn trigger_tray_menu_action(id: String) -> CmdResult<()> {
    #[cfg(target_os = "linux")]
    {
        crate::core::tray::schedule_tray_action(id);
        crate::core::tray::hide_gnome_tray_window();
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = id;
    }

    Ok(())
}

#[tauri::command]
pub async fn hide_tray_menu() -> CmdResult<()> {
    #[cfg(target_os = "linux")]
    {
        crate::core::tray::hide_gnome_tray_window();
    }

    Ok(())
}

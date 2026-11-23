use crate::{config::Config, core::handle::Handle};
use anyhow::Result;
use clash_verge_logging::{Type, logging};

pub async fn update_launch() -> Result<()> {
    let enable_auto_launch = { Config::verge().await.latest_arc().enable_auto_launch };
    let is_enable = enable_auto_launch.unwrap_or(false);
    logging!(info, Type::System, "Setting auto-launch enabled state to: {is_enable}");

    let app_handle = Handle::app_handle();
    cfg_select! {
        target_os = "windows" => {
            use crate::utils::schtasks;
            use tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin;

            let is_admin = is_current_app_handle_admin(app_handle);
            schtasks::set_auto_launch(is_enable, is_admin).await?;
        }
        _ => {
            use clash_verge_logging::logging_error;
            use tauri_plugin_autostart::ManagerExt as _;

            let autostart_manager = app_handle.autolaunch();
            if is_enable {
                logging_error!(Type::System, "{:?}", autostart_manager.enable());
            } else {
                logging_error!(Type::System, "{:?}", autostart_manager.disable());
            }
        }
    }

    Ok(())
}

use super::CmdResult;
use crate::{
    cmd::StringifyErr as _,
    core::{SilentUpdater, updater::DownloadEvent},
    feat,
    utils::dirs,
};
use smartstring::alias::String;
use tauri::{AppHandle, Manager as _, ipc::Channel};

#[tauri::command]
#[specta::specta]
pub async fn quick_panel_state(app: AppHandle, height: Option<f64>, close: bool) -> CmdResult<bool> {
    #[cfg(target_os = "macos")]
    return crate::utils::quick_panel::state(&app, crate::core::tray::TRAY_ID, height, close).stringify_err();
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, height, close);
        Ok(false)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn open_quick_panel_dashboard(route: std::string::String) -> CmdResult<()> {
    if !matches!(route.as_str(), "/" | "/proxies" | "/settings") {
        return Err("Unsupported dashboard route".into());
    }
    if !crate::core::lightweight::exit_lightweight_mode().await {
        crate::utils::window_manager::WindowManager::show_main_window().await;
    }
    let window = crate::utils::window_manager::WindowManager::get_main_window().ok_or("Main window is unavailable")?;
    let url = window.url().stringify_err()?.join(&route).stringify_err()?;
    window.navigate(url).stringify_err()?;
    window.show().stringify_err()?;
    window.set_focus().stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

#[tauri::command]
#[specta::specta]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

#[tauri::command]
#[specta::specta]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn exit_app() {
    feat::quit().await;
}

#[tauri::command]
#[specta::specta]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn install_update(
    app_handle: AppHandle,
    version: std::string::String,
    on_event: Channel<DownloadEvent>,
) -> CmdResult<bool> {
    let version: String = version.into();
    SilentUpdater::global()
        .install_update(&app_handle, &version, |event| {
            let _ = on_event.send(event);
        })
        .await
        .stringify_err()
}

#[tauri::command]
#[specta::specta]
pub fn cancel_update_download() {
    SilentUpdater::global().cancel_download();
}

#[tauri::command]
#[specta::specta]
pub fn get_app_dir() -> CmdResult<std::string::String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

#[tauri::command]
#[specta::specta]
pub async fn download_icon_cache(
    url: std::string::String,
    name: std::string::String,
) -> CmdResult<std::string::String> {
    let url: String = url.into();
    let name: String = name.into();
    feat::download_icon_cache(url, name).await.map(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn copy_icon_file(path: std::string::String, icon_info: feat::IconInfo) -> CmdResult<std::string::String> {
    let path: String = path.into();
    feat::copy_icon_file(path, icon_info).await.map(Into::into)
}

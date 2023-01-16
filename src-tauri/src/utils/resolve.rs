use crate::config::Config;
use crate::log_err;
use crate::{core::*, utils::init, utils::server};
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &mut App) {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    handle::Handle::global().init(app.app_handle());

    log_err!(init::init_resources(app.package_info()));

    // 启动核心
    log_err!(Config::init_config());
    log_err!(CoreManager::global().init());

    // setup a simple http server for singleton
    server::embed_server(app.app_handle());

    log_err!(tray::Tray::update_systray(&app.app_handle()));

    let silent_start = { Config::verge().data().enable_silent_start.clone() };
    if !silent_start.unwrap_or(false) {
        create_window(&app.app_handle());
    }

    log_err!(sysopt::Sysopt::global().init_launch());
    log_err!(sysopt::Sysopt::global().init_sysproxy());

    log_err!(handle::Handle::update_systray_part());
    log_err!(hotkey::Hotkey::global().init(app.app_handle()));
    log_err!(timer::Timer::global().init());
}

/// reset system proxy
pub fn resolve_reset() {
    log_err!(sysopt::Sysopt::global().reset_sysproxy());
    log_err!(CoreManager::global().stop_core());
}

/// create main window
pub fn create_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let builder = tauri::window::WindowBuilder::new(
        app_handle,
        "main".to_string(),
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .center()
    .fullscreen(false)
    .min_inner_size(600.0, 520.0);

    #[cfg(target_os = "windows")]
    {
        use std::time::Duration;
        use tokio::time::sleep;
        use window_shadows::set_shadow;

        match builder
            .decorations(false)
            .transparent(true)
            .inner_size(800.0, 636.0)
            .visible(false)
            .build()
        {
            Ok(_) => {
                let app_handle = app_handle.clone();

                if let Some(window) = app_handle.get_window("main") {
                    let _ = set_shadow(&window, true);
                }

                tauri::async_runtime::spawn(async move {
                    sleep(Duration::from_secs(1)).await;

                    if let Some(window) = app_handle.get_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                });
            }
            Err(err) => log::error!(target: "app", "{err}"),
        }
    }

    #[cfg(target_os = "macos")]
    crate::log_err!(builder
        .decorations(true)
        .inner_size(800.0, 642.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build());

    #[cfg(target_os = "linux")]
    crate::log_err!(builder
        .decorations(true)
        .transparent(false)
        .inner_size(800.0, 642.0)
        .build());
}

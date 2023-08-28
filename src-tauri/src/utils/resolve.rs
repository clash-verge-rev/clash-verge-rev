use crate::{config::Config, core::*, utils::init, utils::server};
use crate::{log_err, trace_err};
use anyhow::Result;
use tauri::{App, AppHandle, Manager};

/// handle something when start app
pub fn resolve_setup(app: &mut App) {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    handle::Handle::global().init(app.app_handle());

    log_err!(init::init_resources(app.package_info()));

    // 启动核心
    log::trace!("init config");
    log_err!(Config::init_config());

    log::trace!("launch core");
    log_err!(CoreManager::global().init());

    // setup a simple http server for singleton
    log::trace!("launch embed server");
    server::embed_server(app.app_handle());

    log::trace!("init system tray");
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
        trace_err!(window.unminimize(), "set win unminimize");
        trace_err!(window.show(), "set win visible");
        trace_err!(window.set_focus(), "set win focus");
        return;
    }

    let mut builder = tauri::window::WindowBuilder::new(
        app_handle,
        "main".to_string(),
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .fullscreen(false)
    .min_inner_size(600.0, 520.0);

    match Config::verge().latest().window_size_position.clone() {
        Some(size_pos) if size_pos.len() == 4 => {
            let size = (size_pos[0], size_pos[1]);
            let pos = (size_pos[2], size_pos[3]);
            let w = size.0.clamp(600.0, f64::INFINITY);
            let h = size.1.clamp(520.0, f64::INFINITY);
            builder = builder.inner_size(w, h).position(pos.0, pos.1);
        }
        _ => {
            #[cfg(target_os = "windows")]
            {
                builder = builder.inner_size(800.0, 636.0).center();
            }

            #[cfg(target_os = "macos")]
            {
                builder = builder.inner_size(800.0, 642.0).center();
            }

            #[cfg(target_os = "linux")]
            {
                builder = builder.inner_size(800.0, 642.0).center();
            }
        }
    };

    #[cfg(target_os = "windows")]
    {
        use std::time::Duration;
        use tokio::time::sleep;
        use window_shadows::set_shadow;

        match builder
            .decorations(false)
            .transparent(true)
            .visible(false)
            .build()
        {
            Ok(win) => {
                log::trace!("try to calculate the monitor size");
                let center = (|| -> Result<bool> {
                    let mut center = false;
                    let monitor = win.current_monitor()?.ok_or(anyhow::anyhow!(""))?;
                    let size = monitor.size();
                    let pos = win.outer_position()?;

                    if pos.x < -400
                        || pos.x > (size.width - 200).try_into()?
                        || pos.y < -200
                        || pos.y > (size.height - 200).try_into()?
                    {
                        center = true;
                    }
                    Ok(center)
                })();

                if center.unwrap_or(true) {
                    trace_err!(win.center(), "set win center");
                }

                log::trace!("try to create window");
                let app_handle = app_handle.clone();

                // 加点延迟避免界面闪一下
                tauri::async_runtime::spawn(async move {
                    sleep(Duration::from_millis(888)).await;

                    if let Some(window) = app_handle.get_window("main") {
                        trace_err!(set_shadow(&window, true), "set win shadow");
                        trace_err!(window.show(), "set win visible");
                        trace_err!(window.unminimize(), "set win unminimize");
                        trace_err!(window.set_focus(), "set win focus");
                    } else {
                        log::error!(target: "app", "failed to create window, get_window is None")
                    }
                });
            }
            Err(err) => log::error!(target: "app", "failed to create window, {err}"),
        }
    }

    #[cfg(target_os = "macos")]
    crate::log_err!(builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build());

    #[cfg(target_os = "linux")]
    crate::log_err!(builder.decorations(true).transparent(false).build());
}

/// save window size and position
pub fn save_window_size_position(app_handle: &AppHandle, save_to_file: bool) -> Result<()> {
    let win = app_handle
        .get_window("main")
        .ok_or(anyhow::anyhow!("failed to get window"))?;

    let scale = win.scale_factor()?;
    let size = win.inner_size()?;
    let size = size.to_logical::<f64>(scale);
    let pos = win.outer_position()?;
    let pos = pos.to_logical::<f64>(scale);

    let verge = Config::verge();
    let mut verge = verge.latest();
    verge.window_size_position = Some(vec![size.width, size.height, pos.x, pos.y]);

    if save_to_file {
        verge.save_file()?;
    }

    Ok(())
}

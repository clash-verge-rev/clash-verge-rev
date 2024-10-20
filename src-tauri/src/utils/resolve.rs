use crate::config::IVerge;
use crate::utils::error;
use crate::{config::Config, config::PrfItem, core::*, utils::init, utils::server};
use crate::{log_err, trace_err, wrap_err};
use anyhow::{bail, Result};
use once_cell::sync::OnceCell;
use percent_encoding::percent_decode_str;
use serde_yaml::Mapping;
use std::net::TcpListener;
use tauri::{App, Manager};

use url::Url;
//#[cfg(not(target_os = "linux"))]
// use window_shadows::set_shadow;
use tauri_plugin_notification::NotificationExt;

pub static VERSION: OnceCell<String> = OnceCell::new();

pub fn find_unused_port() -> Result<u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr()?.port();
            Ok(port)
        }
        Err(_) => {
            let port = Config::verge()
                .latest()
                .verge_mixed_port
                .unwrap_or(Config::clash().data().get_mixed_port());
            log::warn!(target: "app", "use default port: {}", port);
            Ok(port)
        }
    }
}

/// handle something when start app
pub async fn resolve_setup(app: &mut App) {
    error::redirect_panic_to_log();
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let version = app.package_info().version.to_string();

    handle::Handle::global().init(app.app_handle());
    VERSION.get_or_init(|| version.clone());

    log_err!(init::init_config());
    log_err!(init::init_resources());
    log_err!(init::init_scheme());
    log_err!(init::startup_script().await);
    // 处理随机端口
    log_err!(resolve_random_port_config());
    // 启动核心
    log::trace!(target:"app", "init config");
    log_err!(Config::init_config().await);

    if service::check_service().await.is_err() {
        log_err!(service::reinstall_service().await);
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }

    log::trace!(target: "app", "launch core");
    log_err!(CoreManager::global().init().await);

    // setup a simple http server for singleton
    log::trace!(target: "app", "launch embed server");
    server::embed_server();

    log::trace!(target: "app", "init system tray");
    log_err!(tray::Tray::create_systray());

    let silent_start = { Config::verge().data().enable_silent_start };
    if !silent_start.unwrap_or(false) {
        create_window();
    }

    log_err!(sysopt::Sysopt::global().init_launch());
    log_err!(sysopt::Sysopt::global().update_sysproxy().await);
    log_err!(sysopt::Sysopt::global().init_guard_sysproxy());

    log_err!(handle::Handle::update_systray_part());
    log_err!(hotkey::Hotkey::global().init());
    log_err!(timer::Timer::global().init());
}

/// reset system proxy
pub fn resolve_reset() {
    tauri::async_runtime::block_on(async move {
        log_err!(sysopt::Sysopt::global().reset_sysproxy().await);
        log_err!(CoreManager::global().stop_core().await);
    });
}

/// create main window
pub fn create_window() {
    let app_handle = handle::Handle::global().app_handle().unwrap();

    if let Some(window) = handle::Handle::global().get_window() {
        trace_err!(window.unminimize(), "set win unminimize");
        trace_err!(window.show(), "set win visible");
        trace_err!(window.set_focus(), "set win focus");
        return;
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "main".to_string(),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Clash Verge")
    .visible(false)
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
    let window = builder
        .decorations(false)
        .additional_browser_args("--enable-features=msWebView2EnableDraggableRegions --disable-features=OverscrollHistoryNavigation,msExperimentalScrolling")
        .transparent(true)
        .visible(false)
        .build();
    #[cfg(target_os = "macos")]
    let window = builder
        .decorations(true)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build();
    #[cfg(target_os = "linux")]
    let window = builder.decorations(false).transparent(true).build();

    match window {
        Ok(win) => {
            let is_maximized = Config::verge()
                .latest()
                .window_is_maximized
                .unwrap_or(false);
            log::trace!(target:"app", "try to calculate the monitor size");
            let center = (|| -> Result<bool> {
                let mut center = false;
                let monitor = win.current_monitor()?.ok_or(anyhow::anyhow!(""))?;
                let size = monitor.size();
                let pos = win.outer_position()?;

                if pos.x < -400
                    || pos.x > (size.width - 200) as i32
                    || pos.y < -200
                    || pos.y > (size.height - 200) as i32
                {
                    center = true;
                }
                Ok(center)
            })();
            if center.unwrap_or(true) {
                trace_err!(win.center(), "set win center");
            }

            // #[cfg(not(target_os = "linux"))]
            //  trace_err!(set_shadow(&win, true), "set win shadow");
            if is_maximized {
                trace_err!(win.maximize(), "set win maximize");
            }
        }
        Err(_) => {
            log::error!("failed to create window");
        }
    }
}

/// save window size and position
pub fn save_window_size_position(save_to_file: bool) -> Result<()> {
    let app_handle = handle::Handle::global().app_handle().unwrap();
    let verge = Config::verge();
    let mut verge = verge.latest();

    if save_to_file {
        verge.save_file()?;
    }

    let win = app_handle
        .get_webview_window("main")
        .ok_or(anyhow::anyhow!("failed to get window"))?;

    let scale = win.scale_factor()?;
    let size = win.inner_size()?;
    let size = size.to_logical::<f64>(scale);
    let pos = win.outer_position()?;
    let pos = pos.to_logical::<f64>(scale);
    let is_maximized = win.is_maximized()?;
    verge.window_is_maximized = Some(is_maximized);
    if !is_maximized && size.width >= 600.0 && size.height >= 520.0 {
        verge.window_size_position = Some(vec![size.width, size.height, pos.x, pos.y]);
    }
    Ok(())
}

pub async fn resolve_scheme(param: String) -> Result<()> {
    log::info!(target:"app", "received deep link: {}", param);

    let app_handle = handle::Handle::global().app_handle().unwrap();

    let param_str = if param.starts_with("[") && param.len() > 4 {
        param
            .get(2..param.len() - 2)
            .ok_or_else(|| anyhow::anyhow!("Invalid string slice boundaries"))?
    } else {
        param.as_str()
    };

    // 解析 URL
    let link_parsed = match Url::parse(param_str) {
        Ok(url) => url,
        Err(e) => {
            bail!("failed to parse deep link: {:?}, param: {:?}", e, param);
        }
    };

    if link_parsed.scheme() == "clash" || link_parsed.scheme() == "clash-verge" {
        let name = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "name")
            .map(|(_, value)| value.into_owned());

        let encode_url = link_parsed
            .query_pairs()
            .find(|(key, _)| key == "url")
            .map(|(_, value)| value.into_owned());

        match encode_url {
            Some(url) => {
                let url = percent_decode_str(url.as_ref())
                    .decode_utf8_lossy()
                    .to_string();

                create_window();
                match PrfItem::from_url(url.as_ref(), name, None, None).await {
                    Ok(item) => {
                        let uid = item.uid.clone().unwrap();
                        let _ = wrap_err!(Config::profiles().data().append_item(item));
                        app_handle
                            .notification()
                            .builder()
                            .title("Clash Verge")
                            .body("Import profile success")
                            .show()
                            .unwrap();

                        handle::Handle::notice_message("import_sub_url::ok", uid);
                    }
                    Err(e) => {
                        app_handle
                            .notification()
                            .builder()
                            .title("Clash Verge")
                            .body(format!("Import profile failed: {e}"))
                            .show()
                            .unwrap();
                        handle::Handle::notice_message("import_sub_url::error", e.to_string());
                        bail!("Failed to add subscriptions: {e}");
                    }
                }
            }
            None => bail!("failed to get profile url"),
        }
    }

    Ok(())
}

fn resolve_random_port_config() -> Result<()> {
    let verge_config = Config::verge();
    let clash_config = Config::clash();
    let enable_random_port = verge_config.latest().enable_random_port.unwrap_or(false);

    let default_port = verge_config
        .latest()
        .verge_mixed_port
        .unwrap_or(clash_config.data().get_mixed_port());

    let port = if enable_random_port {
        find_unused_port().unwrap_or(default_port)
    } else {
        default_port
    };

    verge_config.data().patch_config(IVerge {
        verge_mixed_port: Some(port),
        ..IVerge::default()
    });
    verge_config.data().save_file()?;

    let mut mapping = Mapping::new();
    mapping.insert("mixed-port".into(), port.into());
    clash_config.data().patch_config(mapping);
    clash_config.data().save_config()?;
    Ok(())
}

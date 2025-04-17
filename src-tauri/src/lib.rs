#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod cmds;
mod config;
mod core;
mod enhance;
mod feat;
mod shutdown;
mod utils;

use crate::{
    config::Config,
    utils::{init, resolve, server},
};
use anyhow::Result;
use core::{tray, verge_log::VergeLog};
use once_cell::sync::OnceCell;
use rust_i18n::t;
use std::{
    backtrace::{Backtrace, BacktraceStatus},
    time::Duration,
};
use tauri::AppHandle;

use utils::dirs::APP_ID;

rust_i18n::i18n!("./src/locales", fallback = "en");

pub static APP_VERSION: OnceCell<String> = OnceCell::new();
pub static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    // 单例检测
    if server::check_singleton().is_err() {
        tracing::info!("app exists");
        return Ok(());
    }

    // 初始化日志
    let _g = VergeLog::global().init()?;

    crate::log_err!(init::init_config());

    let verge = Config::verge().latest().clone();
    let language = verge.language.as_deref();
    let language = language.unwrap_or("zh");
    rust_i18n::set_locale(language);

    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info.payload();

        let payload = if let Some(s) = payload.downcast_ref::<&str>() {
            &**s
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s
        } else {
            &format!("{:?}", payload)
        };

        let location = panic_info
            .location()
            .map(|l| l.to_string())
            .unwrap_or("unknown location".to_string());

        let backtrace = Backtrace::capture();
        let backtrace = if backtrace.status() == BacktraceStatus::Captured {
            t!("panic.info.backtrace", backtrace = backtrace)
        } else {
            t!("panic.info.display.backtrace.note")
        };

        tracing::error!("panicked at {}:\n{}\n{}", location, payload, backtrace);
        let limit_backtrace = backtrace.lines().take(10).collect::<Vec<_>>().join("\n");
        let log_file = VergeLog::global().get_log_file().unwrap_or_default();
        let log_file = log_file.split(APP_ID).last().unwrap_or_default();
        let content = t!(
            "panic.info.content",
            location = location,
            payload = payload,
            limit_backtrace = limit_backtrace,
            log_file = log_file,
        );
        rfd::MessageDialog::new()
            .set_title(t!("panic.info.title"))
            .set_description(content)
            .set_buttons(rfd::MessageButtons::Ok)
            .set_level(rfd::MessageLevel::Error)
            .show();

        // avoid window freezing, spawn a new thread to resolve reset
        let task = std::thread::spawn(|| async {
            resolve::resolve_reset().await;
        });
        let _ = task.join();
        if let Some(app_handle) = APP_HANDLE.get() {
            app_handle.exit(1);
        } else {
            std::process::exit(1);
        }
    }));

    let info = Config::clash().latest().get_client_info();
    let server = info.server;
    let (host, port) = server.split_once(':').unwrap();
    let secret = info.secret;

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_mihomo::Builder::new()
            .external_host(host.into())
            .external_port(port.parse()?)
            .secret(secret)
            .build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let app_handle = app.handle();

            // app version info
            let version = app_handle.package_info().version.to_string();
            APP_VERSION.get_or_init(|| version.clone());
            APP_HANDLE.get_or_init(|| app_handle.clone());

            tracing::trace!("init system tray");
            log_err!(tray::Tray::init(app_handle));

            let verge = Config::verge().data().clone();
            #[cfg(target_os = "macos")]
            {
                let show_in_dock = verge.show_in_dock.unwrap_or(true);
                let _ = app_handle.set_dock_visibility(show_in_dock);
            }

            let enable_splashscreen = verge.enable_splashscreen;
            let enable_splashscreen = enable_splashscreen.unwrap_or(true);
            let silent_start = verge.enable_silent_start;
            let silent_start = silent_start.unwrap_or(false);
            if enable_splashscreen && !silent_start {
                let mut builder = tauri::WebviewWindowBuilder::new(
                    app_handle,
                    "splashscreen",
                    tauri::WebviewUrl::App("splashscreen.html".into()),
                )
                .shadow(false)
                .title("splashscreen")
                .decorations(false)
                .center()
                .resizable(false)
                .inner_size(100.0, 100.0);
                #[cfg(not(target_os = "macos"))]
                {
                    builder = builder.transparent(true);
                }
                #[cfg(target_os = "windows")]
                {
                    builder = builder.additional_browser_args("--enable-features=msWebView2EnableDraggableRegions --disable-features=OverscrollHistoryNavigation,msExperimentalScrolling");
                }
                builder.build()?;
            }

            // we perform the initialization code on a new task so the app doesn't freeze
            tauri::async_runtime::spawn(async move {
                // initialize your app here instead of sleeping :
                resolve::resolve_setup().await;
                // wait 2 seconds for clash core to init profile
                tokio::time::sleep(Duration::from_secs(2)).await;
                // create main window
                if !silent_start {
                    resolve::create_window();
                }
            });

            tracing::trace!("register os shutdown handler");
            shutdown::register();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // common
            cmds::common::get_sys_proxy,
            cmds::common::get_default_bypass,
            cmds::common::get_auto_proxy,
            cmds::common::get_app_dir,
            cmds::common::open_app_dir,
            cmds::common::open_logs_dir,
            cmds::common::open_web_url,
            cmds::common::open_core_dir,
            cmds::common::get_portable_flag,
            cmds::common::is_wayland,
            cmds::common::restart_sidecar,
            cmds::common::grant_permission,
            cmds::common::invoke_uwp_tool,
            cmds::common::check_port_available,
            cmds::common::copy_icon_file,
            cmds::common::download_icon_cache,
            cmds::common::open_devtools,
            cmds::common::set_tray_visible,
            cmds::common::restart_app,
            cmds::common::exit_app,
            // clash
            cmds::clash::get_clash_info,
            cmds::clash::get_clash_logs,
            cmds::clash::patch_clash_config,
            cmds::clash::change_clash_core,
            cmds::clash::get_runtime_config,
            cmds::clash::get_runtime_yaml,
            cmds::clash::get_runtime_logs,
            cmds::clash::get_pre_merge_result,
            cmds::clash::test_merge_chain,
            // verge
            cmds::verge::get_verge_config,
            cmds::verge::patch_verge_config,
            cmds::verge::test_delay,
            // profile
            cmds::profile::get_profiles,
            cmds::profile::get_profile,
            cmds::profile::get_chains,
            cmds::profile::get_template,
            cmds::profile::enhance_profiles,
            cmds::profile::patch_profiles_config,
            cmds::profile::view_profile,
            cmds::profile::patch_profile,
            cmds::profile::create_profile,
            cmds::profile::import_profile,
            cmds::profile::reorder_profile,
            cmds::profile::update_profile,
            cmds::profile::delete_profile,
            cmds::profile::read_profile_file,
            cmds::profile::get_current_profile_rule_providers,
            cmds::profile::save_profile_file,
            // service mode
            cmds::service::check_service,
            cmds::service::install_service,
            cmds::service::uninstall_service,
            // backup
            cmds::backup::create_local_backup,
            cmds::backup::apply_local_backup,
            cmds::backup::update_webdav_info,
            cmds::backup::create_and_upload_backup,
            cmds::backup::list_backup,
            cmds::backup::download_backup_and_reload,
            cmds::backup::delete_backup,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, e| match e {
        tauri::RunEvent::ExitRequested { code, api, .. } if code.is_none() => {
            api.prevent_exit();
        }
        tauri::RunEvent::WindowEvent { label, event, .. } => {
            if label == "main" {
                match event {
                    tauri::WindowEvent::Destroyed => {
                        let _ = resolve::save_window_size_position(app_handle, true);
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        let _ = resolve::save_window_size_position(app_handle, true);
                        resolve::handle_window_close(api, app_handle)
                    }
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        let _ = resolve::save_window_size_position(app_handle, false);
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    });

    Ok(())
}

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
use core::verge_log::VergeLog;
use once_cell::sync::OnceCell;
use tauri::AppHandle;
use tauri_plugin_mihomo::Protocol;

rust_i18n::i18n!("./src/locales", fallback = "en");

pub static APP_VERSION: OnceCell<String> = OnceCell::new();
pub static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

#[cfg(unix)]
pub const MIHOMO_SOCKET_PATH: &str = "/tmp/verge-mihomo.sock";
#[cfg(windows)]
pub const MIHOMO_SOCKET_PATH: &str = r#"\\.\pipe\verge-mihomo"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    // 单例检测
    if server::check_singleton().is_err() {
        tracing::info!("app exists");
        return Ok(());
    }

    let language = {
        Config::verge()
            .latest()
            .language
            .clone()
            .unwrap_or("zh".to_string())
    };
    rust_i18n::set_locale(&language);

    // 初始化日志
    let _g = VergeLog::global().init()?;
    resolve::setup_panic_hook();
    log_err!(init::init_config());

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_mihomo::Builder::new()
                .protocol(Protocol::LocalSocket)
                .socket_path(Some(MIHOMO_SOCKET_PATH.into()))
                .build(),
        )
        .setup(|app| {
            let app_handle = app.handle();
            let _ = APP_HANDLE.set(app_handle.clone());
            let version = app_handle.package_info().version.to_string();
            let _ = APP_VERSION.set(version);

            #[cfg(target_os = "macos")]
            {
                let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let show_in_dock = { Config::verge().latest().show_in_dock.unwrap_or(true) };
                let _ = app_handle.set_dock_visibility(show_in_dock);
            }

            tauri::async_runtime::block_on(async {
                resolve::resolve_setup().await;
            });

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
            cmds::common::copy_clash_env,
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
            cmds::clash::get_rule_providers_payload,
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

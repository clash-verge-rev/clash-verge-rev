mod cmds;
mod config;
mod core;
mod enhance;
mod feat;
mod utils;
use crate::core::hotkey;
use crate::utils::{resolve, resolve::resolve_scheme, server};
#[cfg(target_os = "macos")]
use tauri::Listener;
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    // 单例检测
    let app_exists: bool = tauri::async_runtime::block_on(async move {
        if server::check_singleton().await.is_err() {
            println!("app exists");
            true
        } else {
            false
        }
    });
    if app_exists {
        return;
    }

    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    #[cfg(debug_assertions)]
    let devtools = tauri_plugin_devtools::init();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                log_err!(app.deep_link().register_all());
            }
            #[cfg(target_os = "macos")]
            {
                app.listen("deep-link://new-url", |event| {
                    tauri::async_runtime::spawn(async move {
                        let payload = event.payload();
                        log_err!(resolve_scheme(payload.to_owned()).await);
                    });
                });
            }
            tauri::async_runtime::block_on(async move {
                resolve::resolve_setup(app).await;

                #[cfg(not(target_os = "macos"))]
                {
                    let argvs: Vec<String> = std::env::args().collect();
                    if argvs.len() > 1 {
                        log_err!(resolve_scheme(argvs[1].to_owned()).await);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // common
            cmds::get_sys_proxy,
            cmds::get_auto_proxy,
            cmds::open_app_dir,
            cmds::open_logs_dir,
            cmds::open_web_url,
            cmds::open_core_dir,
            cmds::get_portable_flag,
            cmds::get_network_interfaces,
            // cmds::kill_sidecar,
            cmds::restart_core,
            cmds::restart_app,
            // clash
            cmds::get_clash_info,
            cmds::patch_clash_config,
            cmds::change_clash_core,
            cmds::get_runtime_config,
            cmds::get_runtime_yaml,
            cmds::get_runtime_exists,
            cmds::get_runtime_logs,
            cmds::uwp::invoke_uwp_tool,
            cmds::copy_clash_env,
            // verge
            cmds::get_verge_config,
            cmds::patch_verge_config,
            cmds::test_delay,
            cmds::get_app_dir,
            cmds::copy_icon_file,
            cmds::download_icon_cache,
            cmds::open_devtools,
            cmds::exit_app,
            cmds::get_network_interfaces_info,
            // cmds::update_hotkeys,
            // profile
            cmds::get_profiles,
            cmds::enhance_profiles,
            cmds::patch_profiles_config,
            cmds::view_profile,
            cmds::patch_profile,
            cmds::create_profile,
            cmds::import_profile,
            cmds::reorder_profile,
            cmds::update_profile,
            cmds::delete_profile,
            cmds::read_profile_file,
            cmds::save_profile_file,
            // clash api
            cmds::clash_api_get_proxy_delay,
            // backup
            cmds::create_webdav_backup,
            cmds::save_webdav_config,
            cmds::list_webdav_backup,
            cmds::delete_webdav_backup,
            cmds::restore_webdav_backup,
        ]);

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(devtools);
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_, e| match e {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
                return;
            }
        }
        tauri::RunEvent::WindowEvent { label, event, .. } => {
            if label == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        if core::handle::Handle::global().is_exiting() {
                            return;
                        }
                        println!("closing window...");
                        api.prevent_close();
                        let window = core::handle::Handle::global().get_window().unwrap();
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::Focused(true) => {
                        #[cfg(target_os = "macos")]
                        {
                            log_err!(hotkey::Hotkey::global().register("CMD+Q", "quit"));
                        }

                        #[cfg(not(target_os = "macos"))]
                        {
                            log_err!(hotkey::Hotkey::global().register("Control+Q", "quit"));
                        };
                    }
                    tauri::WindowEvent::Focused(false) => {
                        #[cfg(target_os = "macos")]
                        {
                            log_err!(hotkey::Hotkey::global().unregister("CMD+Q"));
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            log_err!(hotkey::Hotkey::global().unregister("Control+Q"));
                        };
                    }
                    tauri::WindowEvent::Destroyed => {
                        #[cfg(target_os = "macos")]
                        {
                            log_err!(hotkey::Hotkey::global().unregister("CMD+Q"));
                        }

                        #[cfg(not(target_os = "macos"))]
                        {
                            log_err!(hotkey::Hotkey::global().unregister("Control+Q"));
                        };
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    });
}

mod cmds;
mod config;
mod core;
mod enhance;
mod feat;
mod utils;
use crate::core::hotkey;
use crate::utils::{resolve, resolve::resolve_scheme, server};
use config::Config;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use std::{sync::{Mutex, Once}};
use tauri::AppHandle;

/// A global singleton handle to the application.
pub struct AppHandleManager {
    inner: Mutex<Option<AppHandle>>,
    init: Once,
}

impl AppHandleManager {
    /// Get the global instance of the app handle manager.
    pub fn global() -> &'static Self {
        static INSTANCE: AppHandleManager = AppHandleManager {
            inner: Mutex::new(None),
            init: Once::new(),
        };
        &INSTANCE
    }

    /// Initialize the app handle manager with an app handle.
    pub fn init(&self, handle: AppHandle) {
        self.init.call_once(|| {
            let mut app_handle = self.inner.lock().unwrap();
            *app_handle = Some(handle);
        });
    }

    /// Get the app handle if it has been initialized.
    pub fn get(&self) -> Option<AppHandle> {
        self.inner.lock().unwrap().clone()
    }

    /// Get the app handle, panics if it hasn't been initialized.
    pub fn get_handle(&self) -> AppHandle {
        self.get().expect("AppHandle not initialized")
    }

    pub fn set_activation_policy_regular(&self) {
        #[cfg(target_os = "macos")]
        {
            let app_handle = self.inner.lock().unwrap();
            let app_handle = app_handle.as_ref().unwrap();
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
        }
    }
    
    pub fn set_activation_policy_accessory(&self) {
        #[cfg(target_os = "macos")]
        {
            let app_handle = self.inner.lock().unwrap();
            let app_handle = app_handle.as_ref().unwrap();
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    }
    
    pub fn set_activation_policy_prohibited(&self) {
        #[cfg(target_os = "macos")]
        {
            let app_handle = self.inner.lock().unwrap();
            let app_handle = app_handle.as_ref().unwrap();
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Prohibited);
        }
    }
}

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
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                log_err!(app.deep_link().register_all());
            }

            app.deep_link().on_open_url(|event| {
                tauri::async_runtime::spawn(async move {
                    if let Some(url) = event.urls().first() {
                        log_err!(resolve_scheme(url.to_string()).await);
                    }
                });
            });

            tauri::async_runtime::block_on(async move {
                resolve::resolve_setup(app).await;
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
            cmds::restart_core,
            cmds::restart_app,
            // clash
            cmds::get_clash_info,
            cmds::patch_clash_config,
            cmds::patch_clash_mode,
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
            // script validation
            cmds::script_validate_notice,
            cmds::validate_script_file,
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

    app.run(|app_handle, e| match e {
        tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
            AppHandleManager::global().init(app_handle.clone());
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                AppHandleManager::global().set_activation_policy_regular();
            }
            AppHandleManager::global().init(app_handle.clone());
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::WindowEvent { label, event, .. } => {
            if label == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        AppHandleManager::global().set_activation_policy_accessory();
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
                        {   
                            let is_enable_global_hotkey = Config::verge().latest().enable_global_hotkey.unwrap_or(true);
                            if !is_enable_global_hotkey {
                                log_err!(hotkey::Hotkey::global().init())
                            }
                        }
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
                        {   
                            let is_enable_global_hotkey = Config::verge().latest().enable_global_hotkey.unwrap_or(true);
                            if !is_enable_global_hotkey {
                                log_err!(hotkey::Hotkey::global().reset())
                            }
                        }
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

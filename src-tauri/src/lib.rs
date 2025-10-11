#![allow(non_snake_case)]
#![recursion_limit = "512"]

mod cmd;
pub mod config;
mod core;
mod enhance;
mod feat;
mod module;
mod process;
mod utils;
#[cfg(target_os = "macos")]
use crate::utils::window_manager::WindowManager;
use crate::{
    core::{EventDrivenProxyManager, handle, hotkey},
    process::AsyncHandler,
    utils::{resolve, server},
};
use config::Config;
use once_cell::sync::OnceCell;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::time::{Duration, timeout};
use utils::logging::Type;

pub static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

/// Application initialization helper functions
mod app_init {
    use super::*;

    /// Initialize singleton monitoring for other instances
    pub fn init_singleton_check() {
        AsyncHandler::spawn_blocking(move || async move {
            logging!(info, Type::Setup, "开始检查单例实例...");
            match timeout(Duration::from_millis(500), server::check_singleton()).await {
                Ok(result) => {
                    if result.is_err() {
                        logging!(info, Type::Setup, "检测到已有应用实例运行");
                        if let Some(app_handle) = APP_HANDLE.get() {
                            app_handle.exit(0);
                        } else {
                            std::process::exit(0);
                        }
                    } else {
                        logging!(info, Type::Setup, "未检测到其他应用实例");
                    }
                }
                Err(_) => {
                    logging!(warn, Type::Setup, "单例检查超时，假定没有其他实例运行");
                }
            }
        });
    }

    /// Setup plugins for the Tauri builder
    pub fn setup_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        #[allow(unused_mut)]
        let mut builder = builder
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_clipboard_manager::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_http::init())
            .plugin(
                tauri_plugin_mihomo::Builder::new()
                    .protocol(tauri_plugin_mihomo::models::Protocol::LocalSocket)
                    .socket_path(crate::config::IClashTemp::guard_external_controller_ipc())
                    .build(),
            );

        // Devtools plugin only in debug mode with feature tauri-dev
        // to avoid duplicated registering of logger since the devtools plugin also registers a logger
        #[cfg(all(debug_assertions, not(feature = "tokio-trace"), feature = "tauri-dev"))]
        {
            builder = builder.plugin(tauri_plugin_devtools::init());
        }
        builder
    }

    /// Setup deep link handling
    pub fn setup_deep_links(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
        {
            logging!(info, Type::Setup, "注册深层链接...");
            app.deep_link().register_all()?;
        }

        app.deep_link().on_open_url(|event| {
            let url = event.urls().first().map(|u| u.to_string());
            if let Some(url) = url {
                AsyncHandler::spawn(|| async {
                    if let Err(e) = resolve::resolve_scheme(url).await {
                        logging!(error, Type::Setup, "Failed to resolve scheme: {}", e);
                    }
                });
            }
        });

        Ok(())
    }

    /// Setup autostart plugin
    pub fn setup_autostart(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(target_os = "macos")]
        let mut auto_start_plugin_builder = tauri_plugin_autostart::Builder::new();
        #[cfg(not(target_os = "macos"))]
        let auto_start_plugin_builder = tauri_plugin_autostart::Builder::new();

        #[cfg(target_os = "macos")]
        {
            auto_start_plugin_builder = auto_start_plugin_builder
                .macos_launcher(MacosLauncher::LaunchAgent)
                .app_name(app.config().identifier.clone());
        }
        app.handle().plugin(auto_start_plugin_builder.build())?;
        Ok(())
    }

    /// Setup window state management
    pub fn setup_window_state(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        logging!(info, Type::Setup, "初始化窗口状态管理...");
        let window_state_plugin = tauri_plugin_window_state::Builder::new()
            .with_filename("window_state.json")
            .with_state_flags(tauri_plugin_window_state::StateFlags::default())
            .build();
        app.handle().plugin(window_state_plugin)?;
        Ok(())
    }

    /// Generate all command handlers for the application
    pub fn generate_handlers()
    -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
        tauri::generate_handler![
            // Common commands
            cmd::get_sys_proxy,
            cmd::get_auto_proxy,
            cmd::open_app_dir,
            cmd::open_logs_dir,
            cmd::open_web_url,
            cmd::open_core_dir,
            cmd::get_portable_flag,
            cmd::get_network_interfaces,
            cmd::get_system_hostname,
            cmd::restart_app,
            // Core management
            cmd::start_core,
            cmd::stop_core,
            cmd::restart_core,
            // Application lifecycle
            cmd::notify_ui_ready,
            cmd::update_ui_stage,
            cmd::get_running_mode,
            cmd::get_app_uptime,
            cmd::get_auto_launch_status,
            cmd::is_admin,
            // Lightweight mode
            cmd::entry_lightweight_mode,
            cmd::exit_lightweight_mode,
            // Service management
            cmd::install_service,
            cmd::uninstall_service,
            cmd::reinstall_service,
            cmd::repair_service,
            cmd::is_service_available,
            // Clash core commands
            cmd::get_clash_info,
            cmd::patch_clash_config,
            cmd::patch_clash_mode,
            cmd::change_clash_core,
            cmd::get_runtime_config,
            cmd::get_runtime_yaml,
            cmd::get_runtime_exists,
            cmd::get_runtime_logs,
            cmd::get_runtime_proxy_chain_config,
            cmd::update_proxy_chain_config_in_runtime,
            cmd::invoke_uwp_tool,
            cmd::copy_clash_env,
            cmd::sync_tray_proxy_selection,
            cmd::save_dns_config,
            cmd::apply_dns_config,
            cmd::check_dns_config_exists,
            cmd::get_dns_config_content,
            cmd::validate_dns_config,
            cmd::get_clash_logs,
            // Verge configuration
            cmd::get_verge_config,
            cmd::patch_verge_config,
            cmd::test_delay,
            cmd::get_app_dir,
            cmd::copy_icon_file,
            cmd::download_icon_cache,
            cmd::open_devtools,
            cmd::exit_app,
            cmd::get_network_interfaces_info,
            // Profile management
            cmd::get_profiles,
            cmd::enhance_profiles,
            cmd::patch_profiles_config,
            cmd::view_profile,
            cmd::patch_profile,
            cmd::create_profile,
            cmd::import_profile,
            cmd::reorder_profile,
            cmd::update_profile,
            cmd::delete_profile,
            cmd::read_profile_file,
            cmd::save_profile_file,
            cmd::get_next_update_time,
            // Script validation
            cmd::script_validate_notice,
            cmd::validate_script_file,
            // Backup and WebDAV
            cmd::create_webdav_backup,
            cmd::save_webdav_config,
            cmd::list_webdav_backup,
            cmd::delete_webdav_backup,
            cmd::restore_webdav_backup,
            // Diagnostics and system info
            cmd::export_diagnostic_info,
            cmd::get_system_info,
            // Media unlock checker
            cmd::get_unlock_items,
            cmd::check_media_unlock,
        ]
    }
}

pub fn run() {
    // Setup singleton check
    app_init::init_singleton_check();

    let _ = utils::dirs::init_portable_flag();

    // Set Linux environment variable
    #[cfg(target_os = "linux")]
    {
        let desktop_env = std::env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .to_uppercase();
        let session_desktop = std::env::var("XDG_SESSION_DESKTOP")
            .unwrap_or_default()
            .to_uppercase();
        let desktop_session = std::env::var("DESKTOP_SESSION")
            .unwrap_or_default()
            .to_uppercase();
        let is_kde_desktop = desktop_env.contains("KDE");
        let is_plasma_desktop = desktop_env.contains("PLASMA");
        let is_hyprland_desktop = desktop_env.contains("HYPR")
            || session_desktop.contains("HYPR")
            || desktop_session.contains("HYPR");

        let is_wayland_session = std::env::var("XDG_SESSION_TYPE")
            .map(|value| value.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
            || std::env::var("WAYLAND_DISPLAY").is_ok();
        let prefer_native_wayland =
            is_wayland_session && (is_kde_desktop || is_plasma_desktop || is_hyprland_desktop);
        let dmabuf_override = std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER");

        if prefer_native_wayland {
            let compositor_label = if is_hyprland_desktop {
                "Hyprland"
            } else if is_plasma_desktop {
                "KDE Plasma"
            } else {
                "KDE"
            };

            if matches!(dmabuf_override.as_deref(), Ok("1")) {
                unsafe {
                    std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
                }
                logging!(
                    info,
                    Type::Setup,
                    "Wayland + {} detected: Re-enabled WebKit DMABUF renderer to avoid Cairo surface failures.",
                    compositor_label
                );
            } else {
                logging!(
                    info,
                    Type::Setup,
                    "Wayland + {} detected: Using native Wayland backend for reliable rendering.",
                    compositor_label
                );
            }
        } else {
            if dmabuf_override.is_err() {
                unsafe {
                    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                }
            }

            // Force X11 backend for tray icon compatibility on Wayland
            if is_wayland_session {
                unsafe {
                    std::env::set_var("GDK_BACKEND", "x11");
                    std::env::remove_var("WAYLAND_DISPLAY");
                }
                logging!(
                    info,
                    Type::Setup,
                    "Wayland detected: Forcing X11 backend for tray icon compatibility"
                );
            }
        }

        if is_kde_desktop || is_plasma_desktop {
            unsafe {
                std::env::set_var("GTK_CSD", "0");
            }
            logging!(
                info,
                Type::Setup,
                "KDE detected: Disabled GTK CSD for better titlebar stability."
            );
        }
    }

    // Create and configure the Tauri builder
    let builder = app_init::setup_plugins(tauri::Builder::default())
        .setup(|app| {
            logging!(info, Type::Setup, "开始应用初始化...");

            #[allow(clippy::expect_used)]
            APP_HANDLE
                .set(app.app_handle().clone())
                .expect("failed to set global app handle");

            // Setup autostart plugin
            if let Err(e) = app_init::setup_autostart(app) {
                logging!(error, Type::Setup, "Failed to setup autostart: {}", e);
            }

            // Setup deep links
            if let Err(e) = app_init::setup_deep_links(app) {
                logging!(error, Type::Setup, "Failed to setup deep links: {}", e);
            }

            // Setup window state management
            if let Err(e) = app_init::setup_window_state(app) {
                logging!(error, Type::Setup, "Failed to setup window state: {}", e);
            }

            logging!(info, Type::Setup, "执行主要设置操作...");

            resolve::resolve_setup_handle();
            resolve::resolve_setup_async();
            resolve::resolve_setup_sync();

            logging!(info, Type::Setup, "初始化完成，继续执行");
            Ok(())
        })
        .invoke_handler(app_init::generate_handlers());

    /// Event handling helper functions
    mod event_handlers {
        use crate::core::handle;

        use super::*;

        /// Handle application ready/resumed events
        pub fn handle_ready_resumed(_app_handle: &AppHandle) {
            // 双重检查：确保不在退出状态
            if handle::Handle::global().is_exiting() {
                logging!(
                    debug,
                    Type::System,
                    "handle_ready_resumed: 应用正在退出，跳过处理"
                );
                return;
            }

            logging!(info, Type::System, "应用就绪或恢复");
            handle::Handle::global().init();

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = _app_handle.get_webview_window("main") {
                    logging!(info, Type::Window, "设置macOS窗口标题");
                    let _ = window.set_title("Clash Verge");
                }
            }
        }

        /// Handle application reopen events (macOS)
        #[cfg(target_os = "macos")]
        pub async fn handle_reopen(has_visible_windows: bool) {
            logging!(
                info,
                Type::System,
                "处理 macOS 应用重新打开事件: has_visible_windows={}",
                has_visible_windows
            );

            handle::Handle::global().init();

            if !has_visible_windows {
                // 当没有可见窗口时，设置为 regular 模式并显示主窗口
                handle::Handle::global().set_activation_policy_regular();

                logging!(info, Type::System, "没有可见窗口，尝试显示主窗口");

                let result = WindowManager::show_main_window().await;
                logging!(info, Type::System, "窗口显示操作完成，结果: {:?}", result);
            } else {
                logging!(info, Type::System, "已有可见窗口，无需额外操作");
            }
        }

        /// Handle window close requests
        pub fn handle_window_close(api: &tauri::WindowEvent) {
            #[cfg(target_os = "macos")]
            handle::Handle::global().set_activation_policy_accessory();

            if core::handle::Handle::global().is_exiting() {
                return;
            }

            log::info!(target: "app", "closing window...");
            if let tauri::WindowEvent::CloseRequested { api, .. } = api {
                api.prevent_close();
                if let Some(window) = core::handle::Handle::get_window() {
                    let _ = window.hide();
                } else {
                    logging!(warn, Type::Window, "尝试隐藏窗口但窗口不存在");
                }
            }
        }

        /// Handle window focus events
        pub fn handle_window_focus(focused: bool) {
            AsyncHandler::spawn(move || async move {
                let is_enable_global_hotkey = Config::verge()
                    .await
                    .latest_ref()
                    .enable_global_hotkey
                    .unwrap_or(true);

                if focused {
                    #[cfg(target_os = "macos")]
                    {
                        use crate::core::hotkey::SystemHotkey;
                        if let Err(e) = hotkey::Hotkey::global()
                            .register_system_hotkey(SystemHotkey::CmdQ)
                            .await
                        {
                            logging!(error, Type::Hotkey, "Failed to register CMD+Q: {}", e);
                        }
                        if let Err(e) = hotkey::Hotkey::global()
                            .register_system_hotkey(SystemHotkey::CmdW)
                            .await
                        {
                            logging!(error, Type::Hotkey, "Failed to register CMD+W: {}", e);
                        }
                    }

                    if !is_enable_global_hotkey
                        && let Err(e) = hotkey::Hotkey::global().init().await
                    {
                        logging!(error, Type::Hotkey, "Failed to init hotkeys: {}", e);
                    }
                    return;
                }

                // Handle unfocused state
                #[cfg(target_os = "macos")]
                {
                    use crate::core::hotkey::SystemHotkey;
                    if let Err(e) =
                        hotkey::Hotkey::global().unregister_system_hotkey(SystemHotkey::CmdQ)
                    {
                        logging!(error, Type::Hotkey, "Failed to unregister CMD+Q: {}", e);
                    }
                    if let Err(e) =
                        hotkey::Hotkey::global().unregister_system_hotkey(SystemHotkey::CmdW)
                    {
                        logging!(error, Type::Hotkey, "Failed to unregister CMD+W: {}", e);
                    }
                }

                if !is_enable_global_hotkey && let Err(e) = hotkey::Hotkey::global().reset() {
                    logging!(error, Type::Hotkey, "Failed to reset hotkeys: {}", e);
                }
            });
        }

        /// Handle window destroyed events
        pub fn handle_window_destroyed() {
            #[cfg(target_os = "macos")]
            {
                use crate::core::hotkey::SystemHotkey;
                if let Err(e) =
                    hotkey::Hotkey::global().unregister_system_hotkey(SystemHotkey::CmdQ)
                {
                    logging!(
                        error,
                        Type::Hotkey,
                        "Failed to unregister CMD+Q on destroy: {}",
                        e
                    );
                }
                if let Err(e) =
                    hotkey::Hotkey::global().unregister_system_hotkey(SystemHotkey::CmdW)
                {
                    logging!(
                        error,
                        Type::Hotkey,
                        "Failed to unregister CMD+W on destroy: {}",
                        e
                    );
                }
            }
        }
    }

    // Build the application
    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            logging!(
                error,
                Type::Setup,
                "Failed to build Tauri application: {}",
                e
            );
            std::process::exit(1);
        });

    app.run(|app_handle, e| {
        match e {
            tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
                // 如果正在退出，忽略 Ready/Resumed 事件
                if core::handle::Handle::global().is_exiting() {
                    logging!(debug, Type::System, "忽略 Ready/Resumed 事件，应用正在退出");
                    return;
                }
                event_handlers::handle_ready_resumed(app_handle);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                // 如果正在退出，忽略 Reopen 事件
                if core::handle::Handle::global().is_exiting() {
                    logging!(debug, Type::System, "忽略 Reopen 事件，应用正在退出");
                    return;
                }
                AsyncHandler::spawn(move || async move {
                    event_handlers::handle_reopen(has_visible_windows).await;
                });
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                tauri::async_runtime::block_on(async {
                    let _ = handle::Handle::mihomo()
                        .await
                        .clear_all_ws_connections()
                        .await;
                });
                // 如果已经在退出流程中，不要阻止退出
                if core::handle::Handle::global().is_exiting() {
                    logging!(
                        info,
                        Type::System,
                        "应用正在退出，允许 ExitRequested (code: {:?})",
                        code
                    );
                    return;
                }

                // 只阻止外部的无退出码请求（如用户取消系统关机）
                if code.is_none() {
                    logging!(debug, Type::System, "阻止外部退出请求");
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
                let handle = core::handle::Handle::global();

                if handle.is_exiting() {
                    logging!(
                        debug,
                        Type::System,
                        "Exit事件触发，但退出流程已执行，跳过重复清理"
                    );
                } else {
                    logging!(debug, Type::System, "Exit事件触发，执行清理流程");
                    handle.set_is_exiting();
                    EventDrivenProxyManager::global().notify_app_stopping();
                    feat::clean();
                }
            }
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" {
                    match event {
                        tauri::WindowEvent::CloseRequested { .. } => {
                            event_handlers::handle_window_close(&event);
                        }
                        tauri::WindowEvent::Focused(focused) => {
                            event_handlers::handle_window_focus(focused);
                        }
                        tauri::WindowEvent::Destroyed => {
                            event_handlers::handle_window_destroyed();
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    });
}

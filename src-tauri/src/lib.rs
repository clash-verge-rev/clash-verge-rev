mod cmd;
pub mod config;
mod core;
mod enhance;
mod feat;
mod ipc;
mod module;
mod process;
mod state;
mod utils;
use crate::{
    core::hotkey,
    process::AsyncHandler,
    utils::{resolve, resolve::resolve_scheme, server},
};
use config::Config;
use parking_lot::Mutex;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::time::{timeout, Duration};
use utils::logging::Type;

/// A global singleton handle to the application.
pub struct AppHandleManager {
    handle: Mutex<Option<AppHandle>>,
}

impl AppHandleManager {
    /// Create a new AppHandleManager instance
    fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }

    /// Initialize the app handle manager with an app handle.
    pub fn init(&self, handle: AppHandle) {
        let mut app_handle = self.handle.lock();
        if app_handle.is_none() {
            *app_handle = Some(handle);
            logging!(
                info,
                Type::Setup,
                true,
                "AppHandleManager initialized with handle"
            );
        }
    }

    /// Get the app handle if it has been initialized.
    pub fn get(&self) -> Option<AppHandle> {
        self.handle.lock().clone()
    }

    /// Get the app handle, panics if it hasn't been initialized.
    pub fn get_handle(&self) -> AppHandle {
        self.get().expect("AppHandle not initialized")
    }

    /// Check if the app handle has been initialized.
    pub fn is_initialized(&self) -> bool {
        self.handle.lock().is_some()
    }

    #[cfg(target_os = "macos")]
    pub fn set_activation_policy(&self, policy: tauri::ActivationPolicy) -> Result<(), String> {
        let app_handle = self.handle.lock();
        if let Some(app_handle) = app_handle.as_ref() {
            app_handle
                .set_activation_policy(policy)
                .map_err(|e| e.to_string())
        } else {
            Err("AppHandle not initialized".to_string())
        }
    }

    pub fn set_activation_policy_regular(&self) {
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = self.set_activation_policy(tauri::ActivationPolicy::Regular) {
                logging!(
                    warn,
                    Type::Setup,
                    true,
                    "Failed to set regular activation policy: {}",
                    e
                );
            }
        }
    }

    pub fn set_activation_policy_accessory(&self) {
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = self.set_activation_policy(tauri::ActivationPolicy::Accessory) {
                logging!(
                    warn,
                    Type::Setup,
                    true,
                    "Failed to set accessory activation policy: {}",
                    e
                );
            }
        }
    }

    pub fn set_activation_policy_prohibited(&self) {
        #[cfg(target_os = "macos")]
        {
            if let Err(e) = self.set_activation_policy(tauri::ActivationPolicy::Prohibited) {
                logging!(
                    warn,
                    Type::Setup,
                    true,
                    "Failed to set prohibited activation policy: {}",
                    e
                );
            }
        }
    }
}

// Use unified singleton macro
singleton_with_logging!(AppHandleManager, INSTANCE, "AppHandleManager");

/// Application initialization helper functions
mod app_init {
    use super::*;

    /// Initialize singleton monitoring for other instances
    pub fn init_singleton_check() {
        AsyncHandler::spawn(move || async move {
            logging!(info, Type::Setup, true, "开始检查单例实例...");
            match timeout(Duration::from_secs(3), server::check_singleton()).await {
                Ok(result) => {
                    if result.is_err() {
                        logging!(info, Type::Setup, true, "检测到已有应用实例运行");
                        if let Some(app_handle) = AppHandleManager::global().get() {
                            app_handle.exit(0);
                        } else {
                            std::process::exit(0);
                        }
                    } else {
                        logging!(info, Type::Setup, true, "未检测到其他应用实例");
                    }
                }
                Err(_) => {
                    logging!(
                        warn,
                        Type::Setup,
                        true,
                        "单例检查超时，假定没有其他实例运行"
                    );
                }
            }
        });
    }

    /// Setup plugins for the Tauri builder
    pub fn setup_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
        let mut builder = builder
            .plugin(tauri_plugin_notification::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_clipboard_manager::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_deep_link::init());

        #[cfg(debug_assertions)]
        {
            builder = builder.plugin(tauri_plugin_devtools::init());
        }

        builder.manage(std::sync::Mutex::new(
            state::lightweight::LightWeightState::default(),
        ))
    }

    /// Setup deep link handling
    pub fn setup_deep_links(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
        {
            logging!(info, Type::Setup, true, "注册深层链接...");
            app.deep_link().register_all()?;
        }

        app.deep_link().on_open_url(|event| {
            AsyncHandler::spawn(move || {
                let url = event.urls().first().map(|u| u.to_string());
                async move {
                    if let Some(url) = url {
                        if let Err(e) = resolve_scheme(url).await {
                            logging!(error, Type::Setup, true, "Failed to resolve scheme: {}", e);
                        }
                    }
                }
            });
        });

        Ok(())
    }

    /// Setup autostart plugin
    pub fn setup_autostart(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        let mut auto_start_plugin_builder = tauri_plugin_autostart::Builder::new();
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
        logging!(info, Type::Setup, true, "初始化窗口状态管理...");
        let window_state_plugin = tauri_plugin_window_state::Builder::new()
            .with_filename("window_state.json")
            .with_state_flags(tauri_plugin_window_state::StateFlags::default())
            .build();
        app.handle().plugin(window_state_plugin)?;
        Ok(())
    }

    /// Initialize core components asynchronously
    pub fn init_core_async(app_handle: tauri::AppHandle) {
        AsyncHandler::spawn(move || async move {
            logging!(info, Type::Setup, true, "异步执行应用设置...");
            match timeout(
                Duration::from_secs(30),
                resolve::resolve_setup_async(&app_handle),
            )
            .await
            {
                Ok(_) => {
                    logging!(info, Type::Setup, true, "应用设置成功完成");
                }
                Err(_) => {
                    logging!(
                        error,
                        Type::Setup,
                        true,
                        "应用设置超时(30秒)，继续执行后续流程"
                    );
                }
            }
        });
    }

    /// Initialize core components synchronously
    pub fn init_core_sync(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        logging!(info, Type::Setup, true, "初始化AppHandleManager...");
        AppHandleManager::global().init(app_handle.clone());

        logging!(info, Type::Setup, true, "初始化核心句柄...");
        core::handle::Handle::global().init(app_handle);

        logging!(info, Type::Setup, true, "初始化配置...");
        utils::init::init_config()?;

        logging!(info, Type::Setup, true, "初始化资源...");
        utils::init::init_resources()?;

        logging!(info, Type::Setup, true, "核心组件初始化完成");
        Ok(())
    }

    /// Generate all command handlers for the application
    pub fn generate_handlers(
    ) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
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
            cmd::reset_ui_ready_state,
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
            cmd::invoke_uwp_tool,
            cmd::copy_clash_env,
            cmd::get_proxies,
            cmd::force_refresh_proxies,
            cmd::get_providers_proxies,
            cmd::save_dns_config,
            cmd::apply_dns_config,
            cmd::check_dns_config_exists,
            cmd::get_dns_config_content,
            cmd::validate_dns_config,
            cmd::get_clash_version,
            cmd::get_clash_config,
            cmd::force_refresh_clash_config,
            cmd::update_geo_data,
            cmd::upgrade_clash_core,
            cmd::get_clash_rules,
            cmd::update_proxy_choice,
            cmd::get_proxy_providers,
            cmd::get_rule_providers,
            cmd::proxy_provider_health_check,
            cmd::update_proxy_provider,
            cmd::update_rule_provider,
            cmd::get_clash_connections,
            cmd::delete_clash_connection,
            cmd::close_all_clash_connections,
            cmd::get_group_proxy_delays,
            cmd::is_clash_debug_enabled,
            cmd::clash_gc,
            // Logging and monitoring
            cmd::get_clash_logs,
            cmd::start_logs_monitoring,
            cmd::clear_logs,
            cmd::get_traffic_data,
            cmd::get_memory_data,
            cmd::get_formatted_traffic_data,
            cmd::get_formatted_memory_data,
            cmd::get_system_monitor_overview,
            cmd::start_traffic_service,
            cmd::stop_traffic_service,
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
            // Clash API
            cmd::clash_api_get_proxy_delay,
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
    // Initialize network manager
    utils::network::NetworkManager::global().init();

    // Initialize portable flag
    let _ = utils::dirs::init_portable_flag();

    // Setup singleton check
    app_init::init_singleton_check();

    // Set Linux environment variable
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    // Create and configure the Tauri builder
    let builder = app_init::setup_plugins(tauri::Builder::default())
        .setup(|app| {
            logging!(info, Type::Setup, true, "开始应用初始化...");

            // Setup autostart plugin
            if let Err(e) = app_init::setup_autostart(app) {
                logging!(error, Type::Setup, true, "Failed to setup autostart: {}", e);
            }

            // Setup deep links
            if let Err(e) = app_init::setup_deep_links(app) {
                logging!(
                    error,
                    Type::Setup,
                    true,
                    "Failed to setup deep links: {}",
                    e
                );
            }

            // Setup window state management
            if let Err(e) = app_init::setup_window_state(app) {
                logging!(
                    error,
                    Type::Setup,
                    true,
                    "Failed to setup window state: {}",
                    e
                );
            }

            // Initialize core components asynchronously
            app_init::init_core_async(app.handle().clone());

            logging!(info, Type::Setup, true, "执行主要设置操作...");

            // Initialize core components synchronously
            if let Err(e) = app_init::init_core_sync(app.handle()) {
                logging!(
                    error,
                    Type::Setup,
                    true,
                    "Failed to initialize core components: {}",
                    e
                );
                return Err(e);
            }

            logging!(info, Type::Setup, true, "初始化完成，继续执行");
            Ok(())
        })
        .invoke_handler(app_init::generate_handlers());

    /// Event handling helper functions
    mod event_handlers {
        use super::*;

        /// Handle application ready/resumed events
        pub fn handle_ready_resumed(app_handle: &tauri::AppHandle) {
            logging!(info, Type::System, true, "应用就绪或恢复");
            AppHandleManager::global().init(app_handle.clone());

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    logging!(info, Type::Window, true, "设置macOS窗口标题");
                    let _ = window.set_title("Clash Verge");
                }
            }
        }

        /// Handle application reopen events (macOS)
        #[cfg(target_os = "macos")]
        pub fn handle_reopen(app_handle: &tauri::AppHandle, has_visible_windows: bool) {
            if !has_visible_windows {
                AppHandleManager::global().set_activation_policy_regular();
            }
            AppHandleManager::global().init(app_handle.clone());
        }

        /// Handle window close requests
        pub fn handle_window_close(api: &tauri::WindowEvent) {
            #[cfg(target_os = "macos")]
            AppHandleManager::global().set_activation_policy_accessory();

            if core::handle::Handle::global().is_exiting() {
                return;
            }

            log::info!(target: "app", "closing window...");
            if let tauri::WindowEvent::CloseRequested { api, .. } = api {
                api.prevent_close();
                if let Some(window) = core::handle::Handle::global().get_window() {
                    let _ = window.hide();
                } else {
                    logging!(warn, Type::Window, true, "尝试隐藏窗口但窗口不存在");
                }
            }
        }

        /// Handle window focus events
        pub fn handle_window_focus(focused: bool) {
            let is_enable_global_hotkey = Config::verge()
                .latest_ref()
                .enable_global_hotkey
                .unwrap_or(true);

            if focused {
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = hotkey::Hotkey::global().register("CMD+Q", "quit") {
                        logging!(error, Type::Hotkey, true, "Failed to register CMD+Q: {}", e);
                    }
                    if let Err(e) = hotkey::Hotkey::global().register("CMD+W", "hide") {
                        logging!(error, Type::Hotkey, true, "Failed to register CMD+W: {}", e);
                    }
                }

                if !is_enable_global_hotkey {
                    if let Err(e) = hotkey::Hotkey::global().init() {
                        logging!(error, Type::Hotkey, true, "Failed to init hotkeys: {}", e);
                    }
                }
            } else {
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = hotkey::Hotkey::global().unregister("CMD+Q") {
                        logging!(
                            error,
                            Type::Hotkey,
                            true,
                            "Failed to unregister CMD+Q: {}",
                            e
                        );
                    }
                    if let Err(e) = hotkey::Hotkey::global().unregister("CMD+W") {
                        logging!(
                            error,
                            Type::Hotkey,
                            true,
                            "Failed to unregister CMD+W: {}",
                            e
                        );
                    }
                }

                if !is_enable_global_hotkey {
                    if let Err(e) = hotkey::Hotkey::global().reset() {
                        logging!(error, Type::Hotkey, true, "Failed to reset hotkeys: {}", e);
                    }
                }
            }
        }

        /// Handle window destroyed events
        pub fn handle_window_destroyed() {
            #[cfg(target_os = "macos")]
            {
                if let Err(e) = hotkey::Hotkey::global().unregister("CMD+Q") {
                    logging!(
                        error,
                        Type::Hotkey,
                        true,
                        "Failed to unregister CMD+Q on destroy: {}",
                        e
                    );
                }
                if let Err(e) = hotkey::Hotkey::global().unregister("CMD+W") {
                    logging!(
                        error,
                        Type::Hotkey,
                        true,
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
        .expect("error while running tauri application");

    app.run(|app_handle, e| match e {
        tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
            event_handlers::handle_ready_resumed(app_handle);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            event_handlers::handle_reopen(app_handle, has_visible_windows);
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            // Avoid duplicate cleanup
            if core::handle::Handle::global().is_exiting() {
                return;
            }
            feat::clean();
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
    });
}

use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Result;

use crate::{
    config::Config,
    core::{
        CoreManager, Timer,
        handle::Handle,
        hotkey::Hotkey,
        logger::Logger,
        service::{SERVICE_MANAGER, ServiceManager},
        tray::Tray,
    },
    feat,
    module::{auto_backup::AutoBackupManager, lightweight::auto_lightweight_boot},
    process::AsyncHandler,
    utils::{init, server, window_manager::WindowManager},
};
use clash_verge_logging::{Type, logging, logging_error};

pub mod dns;
mod scheme;
pub(crate) mod window;
mod window_script;

static RESOLVE_DONE: AtomicBool = AtomicBool::new(false);

pub(crate) fn init_work_dir_and_logger() -> anyhow::Result<()> {
    AsyncHandler::block_on(async {
        init_work_config().await;
        logging!(info, Type::Setup, "Initializing logger");
        Logger::global().init().await?;
        Ok(())
    })
}

pub(crate) fn resolve_setup_sync() {
    AsyncHandler::spawn(|| async {
        AsyncHandler::spawn_blocking(init_scheme);
        AsyncHandler::spawn_blocking(server::embed_server);
        #[cfg(target_os = "linux")]
        AsyncHandler::spawn_blocking(watch_linux_theme_changed);
    });
}

pub(crate) fn resolve_setup_async() {
    AsyncHandler::spawn(|| async {
        logging!(info, Type::ClashVergeRev, "Version: {}", env!("CARGO_PKG_VERSION"));

        // Migrate before windows or timers can change the loaded config.
        logging_error!(Type::Setup, init::migrate_short_update_intervals().await);

        #[cfg(target_os = "macos")]
        resolve_dock_show().await;
        init_startup_script().await;
        init_service_manager().await;
        let config_initialized = init_verge_config_before_window().await;
        init_window().await;
        feat::reconcile_startup_tun_availability().await;
        init_resources().await;
        if let Err(e) = init::init_dns_config().await {
            logging!(warn, Type::Setup, "DNS config initialization failed: {}", e);
        }
        if config_initialized {
            init_verge_config().await;
        }
        Config::verify_config_initialization().await;

        let core_init = AsyncHandler::spawn(|| async {
            init_core_manager().await;
        });

        let _ = futures::join!(
            core_init,
            init_tray(),
            init_timer(),
            init_hotkey(),
            init_auto_lightweight_boot(),
            init_auto_backup(),
            init_silent_updater(),
        );

        Handle::refresh_clash();
        refresh_tray_menu().await;
        resolve_done();
    });
}

pub async fn resolve_reset_async() -> Result<(), anyhow::Error> {
    CoreManager::global().stop_core().await?;

    #[cfg(target_os = "macos")]
    {
        use dns::restore_public_dns;
        restore_public_dns().await;
    }

    Ok(())
}

fn init_scheme() {
    logging_error!(Type::Setup, init::init_scheme());
}

pub(crate) async fn resolve_scheme(param: &str) {
    logging_error!(Type::Setup, scheme::resolve_scheme(param).await);
}

#[cfg(target_os = "linux")]
fn watch_linux_theme_changed() {
    match dark_light::subscribe() {
        Ok(watcher) => {
            for mode in watcher.iter() {
                use crate::core::notification;

                let theme = match mode {
                    dark_light::Mode::Light => tauri::Theme::Light,
                    dark_light::Mode::Dark => tauri::Theme::Dark,
                    dark_light::Mode::Unspecified => tauri::Theme::Light, // fallback to light
                };
                notification::NotificationSystem::send_event(
                    Handle::app_handle().clone(),
                    notification::FrontendEvent::ThemeChanged { theme },
                );
            }
        }
        Err(e) => {
            logging_error!(Type::Setup, "Fail to watch linux theme changed: {}", e);
        }
    }
}

async fn init_resources() {
    logging_error!(Type::Setup, init::init_resources().await);
}

async fn init_startup_script() {
    logging_error!(Type::Setup, init::startup_script().await);
}

async fn init_timer() {
    logging_error!(Type::Setup, Timer::global().init().await);
}

async fn init_hotkey() {
    let skip_register_hotkeys = !Config::verge().await.latest_arc().enable_global_hotkey.unwrap_or(true);
    logging_error!(Type::Setup, Hotkey::global().init(skip_register_hotkeys).await);
}

async fn init_auto_lightweight_boot() {
    logging_error!(Type::Setup, auto_lightweight_boot().await);
}

async fn init_auto_backup() {
    logging_error!(Type::Setup, AutoBackupManager::global().init().await);
}

async fn init_silent_updater() {
    use crate::core::SilentUpdater;
    use crate::core::handle::Handle;

    logging!(info, Type::Setup, "Initializing silent updater...");

    let app_handle = Handle::app_handle();

    // Install cached updates before starting background checks.
    if SilentUpdater::global().try_install_on_startup(app_handle).await {
        logging!(info, Type::Setup, "Update installed at startup, restarting...");
        feat::restart_app().await;
    }

    let app_handle = app_handle.clone();
    tokio::spawn(async move {
        SilentUpdater::global().start_background_check(app_handle).await;
    });

    logging!(info, Type::Setup, "Silent updater initialized");
}

async fn init_work_config() {
    logging_error!(Type::Setup, init::init_config().await);
}

async fn init_tray() {
    logging_error!(Type::Setup, Tray::global().init().await);
}

async fn init_verge_config() {
    logging_error!(Type::Setup, Config::init_runtime_config().await);
}

async fn init_verge_config_before_window() -> bool {
    let result = Config::init_config_before_window().await;
    let success = result.is_ok();
    logging_error!(Type::Setup, result);
    success
}

async fn init_service_manager() {
    clash_verge_service_ipc::set_config(Some(ServiceManager::config())).await;

    SERVICE_MANAGER.detect_startup_status().await;
}

async fn init_core_manager() -> bool {
    match CoreManager::global().init().await {
        Ok(initialized) => initialized,
        Err(error) => {
            logging!(error, Type::Setup, "core manager initialization failed: {error:#}");
            false
        }
    }
}

async fn refresh_tray_menu() {
    logging_error!(Type::Setup, Tray::global().update_part().await);
}

async fn init_window() {
    let is_silent_start = Config::verge().await.data_arc().enable_silent_start.unwrap_or(false);
    WindowManager::create_window(!is_silent_start).await;
}

#[cfg(target_os = "macos")]
async fn resolve_dock_show() {
    let is_silent_start = Config::verge().await.data_arc().enable_silent_start.unwrap_or(false);
    if is_silent_start {
        Handle::global().set_activation_policy_accessory();
    }
}

fn resolve_done() {
    RESOLVE_DONE.store(true, Ordering::Release);
}

pub(crate) fn is_resolve_done() -> bool {
    RESOLVE_DONE.load(Ordering::Acquire)
}

use anyhow::Result;

use crate::{
    config::Config,
    core::{
        CoreManager, Timer, handle,
        hotkey::Hotkey,
        service::{SERVICE_MANAGER, ServiceManager, is_service_ipc_path_exists},
        sysopt,
        tray::Tray,
    },
    logging, logging_error,
    module::{auto_backup::AutoBackupManager, lightweight::auto_lightweight_boot, signal},
    process::AsyncHandler,
    utils::{init, logging::Type, server, window_manager::WindowManager},
};

pub mod dns;
pub mod scheme;
pub mod ui;
pub mod window;
pub mod window_script;

pub fn resolve_setup_handle() {
    init_handle();
}

pub fn resolve_setup_sync() {
    AsyncHandler::spawn(|| async {
        AsyncHandler::spawn_blocking(init_scheme);
        AsyncHandler::spawn_blocking(init_embed_server);
        AsyncHandler::spawn_blocking(init_signal);
    });
}

pub fn resolve_setup_async() {
    AsyncHandler::spawn(|| async {
        #[cfg(not(feature = "tauri-dev"))]
        resolve_setup_logger().await;
        logging!(
            info,
            Type::ClashVergeRev,
            "Version: {}",
            env!("CARGO_PKG_VERSION")
        );

        futures::join!(init_work_config(), init_resources(), init_startup_script());

        init_verge_config().await;
        Config::verify_config_initialization().await;
        init_window().await;

        let core_init = AsyncHandler::spawn(|| async {
            init_service_manager().await;
            init_core_manager().await;
            init_system_proxy().await;
            AsyncHandler::spawn_blocking(init_system_proxy_guard);
        });

        let tray_init = async {
            init_tray().await;
            refresh_tray_menu().await;
        };

        let _ = futures::join!(
            core_init,
            tray_init,
            init_timer(),
            init_hotkey(),
            init_auto_lightweight_boot(),
            init_auto_backup(),
        );
    });
}

pub async fn resolve_reset_async() -> Result<(), anyhow::Error> {
    sysopt::Sysopt::global().reset_sysproxy().await?;
    CoreManager::global().stop_core().await?;

    #[cfg(target_os = "macos")]
    {
        use dns::restore_public_dns;
        restore_public_dns().await;
    }

    Ok(())
}

pub fn init_handle() {
    handle::Handle::global().init();
}

pub(super) fn init_scheme() {
    logging_error!(Type::Setup, init::init_scheme());
}

#[cfg(not(feature = "tauri-dev"))]
pub(super) async fn resolve_setup_logger() {
    logging_error!(Type::Setup, init::init_logger().await);
}

pub async fn resolve_scheme(param: &str) -> Result<()> {
    logging_error!(Type::Setup, scheme::resolve_scheme(param).await);
    Ok(())
}

pub(super) fn init_embed_server() {
    server::embed_server();
}

pub(super) async fn init_resources() {
    logging_error!(Type::Setup, init::init_resources().await);
}

pub(super) async fn init_startup_script() {
    logging_error!(Type::Setup, init::startup_script().await);
}

pub(super) async fn init_timer() {
    logging_error!(Type::Setup, Timer::global().init().await);
}

pub(super) async fn init_hotkey() {
    logging_error!(Type::Setup, Hotkey::global().init(false).await);
}

pub(super) async fn init_auto_lightweight_boot() {
    logging_error!(Type::Setup, auto_lightweight_boot().await);
}

pub(super) async fn init_auto_backup() {
    logging_error!(Type::Setup, AutoBackupManager::global().init().await);
}

pub(super) fn init_signal() {
    logging!(info, Type::Setup, "Initializing signal handlers...");
    signal::register();
}

pub async fn init_work_config() {
    logging_error!(Type::Setup, init::init_config().await);
}

pub(super) async fn init_tray() {
    if std::env::var("CLASH_VERGE_DISABLE_TRAY").unwrap_or_default() == "1" {
        return;
    }
    logging_error!(Type::Setup, Tray::global().init().await);
}

pub(super) async fn init_verge_config() {
    logging_error!(Type::Setup, Config::init_config().await);
}

pub(super) async fn init_service_manager() {
    clash_verge_service_ipc::set_config(ServiceManager::config()).await;
    if !is_service_ipc_path_exists() {
        return;
    }
    if SERVICE_MANAGER.lock().await.init().await.is_ok() {
        logging_error!(Type::Setup, SERVICE_MANAGER.lock().await.refresh().await);
    }
}

pub(super) async fn init_core_manager() {
    logging_error!(Type::Setup, CoreManager::global().init().await);
}

pub(super) async fn init_system_proxy() {
    logging_error!(
        Type::Setup,
        sysopt::Sysopt::global().update_sysproxy().await
    );
}

pub(super) fn init_system_proxy_guard() {
    logging_error!(Type::Setup, sysopt::Sysopt::global().init_guard_sysproxy());
}

pub(super) async fn refresh_tray_menu() {
    logging_error!(Type::Setup, Tray::global().update_part().await);
}

pub(super) async fn init_window() {
    let is_silent_start = Config::verge()
        .await
        .data_arc()
        .enable_silent_start
        .unwrap_or(false);
    #[cfg(target_os = "macos")]
    if is_silent_start {
        use crate::core::handle::Handle;
        Handle::global().set_activation_policy_accessory();
    }
    WindowManager::create_window(!is_silent_start).await;
}

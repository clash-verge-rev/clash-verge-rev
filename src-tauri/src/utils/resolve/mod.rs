use anyhow::Result;
use tauri::AppHandle;

use crate::{
    config::Config,
    core::{CoreManager, Timer, handle, hotkey::Hotkey, sysopt, tray::Tray},
    logging, logging_error,
    module::lightweight::auto_lightweight_mode_init,
    process::AsyncHandler,
    utils::{init, logging::Type, resolve::window::create_window, server},
};

pub mod dns;
pub mod scheme;
pub mod ui;
pub mod window;
pub mod window_script;

pub fn resolve_setup_handle(app_handle: AppHandle) {
    init_handle(app_handle);
}

pub fn resolve_setup_sync() {
    AsyncHandler::spawn(|| async {
        AsyncHandler::spawn_blocking(init_scheme);
        AsyncHandler::spawn_blocking(init_embed_server);
    });
}

pub fn resolve_setup_async() {
    let start_time = std::time::Instant::now();
    logging!(
        info,
        Type::Setup,
        true,
        "开始执行异步设置任务... 线程ID: {:?}",
        std::thread::current().id()
    );

    AsyncHandler::spawn(|| async {
        futures::join!(
            init_work_config(),
            init_resources(),
            init_startup_script(),
            init_hotkey(),
        );

        init_timer().await;
        init_auto_lightweight_mode().await;

        init_verge_config().await;
        init_core_manager().await;

        init_system_proxy().await;
        AsyncHandler::spawn_blocking(|| {
            init_system_proxy_guard();
        });

        let tray_and_refresh = async {
            init_tray().await;
            refresh_tray_menu().await;
        };
        futures::join!(init_window(), tray_and_refresh,);
    });

    let elapsed = start_time.elapsed();
    logging!(
        info,
        Type::Setup,
        true,
        "异步设置任务完成，耗时: {:?}",
        elapsed
    );

    if elapsed.as_secs() > 10 {
        logging!(
            warn,
            Type::Setup,
            true,
            "异步设置任务耗时较长({:?})",
            elapsed
        );
    }
}

// 其它辅助函数不变
pub async fn resolve_reset_async() {
    logging!(info, Type::Tray, true, "Resetting system proxy");
    logging_error!(
        Type::System,
        true,
        sysopt::Sysopt::global().reset_sysproxy().await
    );

    logging!(info, Type::Core, true, "Stopping core service");
    logging_error!(Type::Core, true, CoreManager::global().stop_core().await);

    #[cfg(target_os = "macos")]
    {
        use dns::restore_public_dns;

        logging!(info, Type::System, true, "Restoring system DNS settings");
        restore_public_dns().await;
    }
}

pub fn init_handle(app_handle: AppHandle) {
    logging!(info, Type::Setup, true, "Initializing app handle...");
    handle::Handle::global().init(app_handle);
}

pub(super) fn init_scheme() {
    logging!(info, Type::Setup, true, "Initializing custom URL scheme");
    logging_error!(Type::Setup, true, init::init_scheme());
}

pub async fn resolve_scheme(param: String) -> Result<()> {
    logging!(
        info,
        Type::Setup,
        true,
        "Resolving scheme for param: {}",
        param
    );
    logging_error!(Type::Setup, true, scheme::resolve_scheme(param).await);
    Ok(())
}

pub(super) fn init_embed_server() {
    logging!(info, Type::Setup, true, "Initializing embedded server...");
    server::embed_server();
}
pub(super) async fn init_resources() {
    logging!(info, Type::Setup, true, "Initializing resources...");
    logging_error!(Type::Setup, true, init::init_resources().await);
}

pub(super) async fn init_startup_script() {
    logging!(info, Type::Setup, true, "Initializing startup script");
    logging_error!(Type::Setup, true, init::startup_script().await);
}

pub(super) async fn init_timer() {
    logging!(info, Type::Setup, true, "Initializing timer...");
    logging_error!(Type::Setup, true, Timer::global().init().await);
}

pub(super) async fn init_hotkey() {
    logging!(info, Type::Setup, true, "Initializing hotkey...");
    logging_error!(Type::Setup, true, Hotkey::global().init().await);
}

pub(super) async fn init_auto_lightweight_mode() {
    logging!(
        info,
        Type::Setup,
        true,
        "Initializing auto lightweight mode..."
    );
    logging_error!(Type::Setup, true, auto_lightweight_mode_init().await);
}

pub async fn init_work_config() {
    logging!(
        info,
        Type::Setup,
        true,
        "Initializing work configuration..."
    );
    logging_error!(Type::Setup, true, init::init_config().await);
}

pub(super) async fn init_tray() {
    logging!(info, Type::Setup, true, "Initializing system tray...");
    logging_error!(Type::Setup, true, Tray::global().init().await);
}

pub(super) async fn init_verge_config() {
    logging!(
        info,
        Type::Setup,
        true,
        "Initializing verge configuration..."
    );
    logging_error!(Type::Setup, true, Config::init_config().await);
}

pub(super) async fn init_core_manager() {
    logging!(info, Type::Setup, true, "Initializing core manager...");
    logging_error!(Type::Setup, true, CoreManager::global().init().await);
}

pub(super) async fn init_system_proxy() {
    logging!(info, Type::Setup, true, "Initializing system proxy...");
    logging_error!(
        Type::Setup,
        true,
        sysopt::Sysopt::global().update_sysproxy().await
    );
}

pub(super) fn init_system_proxy_guard() {
    logging!(
        info,
        Type::Setup,
        true,
        "Initializing system proxy guard..."
    );
    logging_error!(
        Type::Setup,
        true,
        sysopt::Sysopt::global().init_guard_sysproxy()
    );
}

pub(super) async fn refresh_tray_menu() {
    logging!(info, Type::Setup, true, "Refreshing tray menu...");
    logging_error!(Type::Setup, true, Tray::global().update_part().await);
}

pub(super) async fn init_window() {
    let is_silent_start =
        { Config::verge().await.latest_ref().enable_silent_start }.unwrap_or(false);
    #[cfg(target_os = "macos")]
    {
        if is_silent_start {
            use crate::core::handle::Handle;

            Handle::global().set_activation_policy_accessory();
        }
    }
    create_window(!is_silent_start).await;
}

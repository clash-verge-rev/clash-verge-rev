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
    module::lightweight::{auto_lightweight_mode_init, run_once_auto_lightweight},
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
    });
}

pub fn resolve_setup_async() {
    let start_time = std::time::Instant::now();
    logging!(
        info,
        Type::Setup,
        "开始执行异步设置任务... 线程ID: {:?}",
        std::thread::current().id()
    );

    AsyncHandler::spawn(|| async {
        #[cfg(not(feature = "tauri-dev"))]
        resolve_setup_logger().await;
        logging!(
            info,
            Type::ClashVergeRev,
            "Version: {}",
            env!("CARGO_PKG_VERSION")
        );
        futures::join!(init_service_manager());

        futures::join!(
            init_work_config(),
            init_resources(),
            init_startup_script(),
            init_hotkey(),
        );

        init_timer().await;
        init_once_auto_lightweight().await;
        init_auto_lightweight_mode().await;

        // 确保配置完全初始化后再启动核心管理器
        init_verge_config().await;

        // 添加配置验证，确保运行时配置已正确生成
        Config::verify_config_initialization().await;

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
    logging!(info, Type::Setup, "异步设置任务完成，耗时: {:?}", elapsed);

    if elapsed.as_secs() > 10 {
        logging!(warn, Type::Setup, "异步设置任务耗时较长({:?})", elapsed);
    }
}

// 其它辅助函数不变
pub async fn resolve_reset_async() -> Result<(), anyhow::Error> {
    logging!(info, Type::Tray, "Resetting system proxy");
    sysopt::Sysopt::global().reset_sysproxy().await?;

    logging!(info, Type::Core, "Stopping core service");
    CoreManager::global().stop_core().await?;

    #[cfg(target_os = "macos")]
    {
        use dns::restore_public_dns;

        logging!(info, Type::System, "Restoring system DNS settings");
        restore_public_dns().await;
    }

    Ok(())
}

pub fn init_handle() {
    logging!(info, Type::Setup, "Initializing app handle...");
    handle::Handle::global().init();
}

pub(super) fn init_scheme() {
    logging!(info, Type::Setup, "Initializing custom URL scheme");
    logging_error!(Type::Setup, init::init_scheme());
}

#[cfg(not(feature = "tauri-dev"))]
pub(super) async fn resolve_setup_logger() {
    logging!(info, Type::Setup, "Initializing global logger...");
    logging_error!(Type::Setup, init::init_logger().await);
}

pub async fn resolve_scheme(param: String) -> Result<()> {
    logging!(info, Type::Setup, "Resolving scheme for param: {}", param);
    logging_error!(Type::Setup, scheme::resolve_scheme(param).await);
    Ok(())
}

pub(super) fn init_embed_server() {
    logging!(info, Type::Setup, "Initializing embedded server...");
    server::embed_server();
}
pub(super) async fn init_resources() {
    logging!(info, Type::Setup, "Initializing resources...");
    logging_error!(Type::Setup, init::init_resources().await);
}

pub(super) async fn init_startup_script() {
    logging!(info, Type::Setup, "Initializing startup script");
    logging_error!(Type::Setup, init::startup_script().await);
}

pub(super) async fn init_timer() {
    logging!(info, Type::Setup, "Initializing timer...");
    logging_error!(Type::Setup, Timer::global().init().await);
}

pub(super) async fn init_hotkey() {
    logging!(info, Type::Setup, "Initializing hotkey...");
    logging_error!(Type::Setup, Hotkey::global().init().await);
}

pub(super) async fn init_once_auto_lightweight() {
    logging!(
        info,
        Type::Lightweight,
        "Running auto lightweight mode check..."
    );
    run_once_auto_lightweight().await;
}

pub(super) async fn init_auto_lightweight_mode() {
    logging!(info, Type::Setup, "Initializing auto lightweight mode...");
    logging_error!(Type::Setup, auto_lightweight_mode_init().await);
}

pub async fn init_work_config() {
    logging!(info, Type::Setup, "Initializing work configuration...");
    logging_error!(Type::Setup, init::init_config().await);
}

pub(super) async fn init_tray() {
    // Check if tray should be disabled via environment variable
    if std::env::var("CLASH_VERGE_DISABLE_TRAY").unwrap_or_default() == "1" {
        logging!(info, Type::Setup, "System tray disabled via --no-tray flag");
        return;
    }

    logging!(info, Type::Setup, "Initializing system tray...");
    logging_error!(Type::Setup, Tray::global().init().await);
}

pub(super) async fn init_verge_config() {
    logging!(info, Type::Setup, "Initializing verge configuration...");
    logging_error!(Type::Setup, Config::init_config().await);
}

pub(super) async fn init_service_manager() {
    logging!(info, Type::Setup, "Initializing service manager...");
    clash_verge_service_ipc::set_config(ServiceManager::config()).await;
    if !is_service_ipc_path_exists() {
        logging!(
            warn,
            Type::Setup,
            "Service IPC path does not exist, service may be unavailable"
        );
        return;
    }
    if SERVICE_MANAGER.lock().await.init().await.is_ok() {
        logging_error!(Type::Setup, SERVICE_MANAGER.lock().await.refresh().await);
    }
}

pub(super) async fn init_core_manager() {
    logging!(info, Type::Setup, "Initializing core manager...");
    logging_error!(Type::Setup, CoreManager::global().init().await);
}

pub(super) async fn init_system_proxy() {
    logging!(info, Type::Setup, "Initializing system proxy...");
    logging_error!(
        Type::Setup,
        sysopt::Sysopt::global().update_sysproxy().await
    );
}

pub(super) fn init_system_proxy_guard() {
    logging!(info, Type::Setup, "Initializing system proxy guard...");
    logging_error!(Type::Setup, sysopt::Sysopt::global().init_guard_sysproxy());
}

pub(super) async fn refresh_tray_menu() {
    logging!(info, Type::Setup, "Refreshing tray menu...");
    logging_error!(Type::Setup, Tray::global().update_part().await);
}

pub(super) async fn init_window() {
    logging!(info, Type::Setup, "Initializing main window...");
    let is_silent_start =
        { Config::verge().await.latest_ref().enable_silent_start }.unwrap_or(false);
    #[cfg(target_os = "macos")]
    {
        if is_silent_start {
            use crate::core::handle::Handle;

            Handle::global().set_activation_policy_accessory();
        }
    }
    WindowManager::create_window(!is_silent_start).await;
}

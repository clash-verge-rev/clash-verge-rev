use anyhow::Result;
use clash_verge_logging::{LoggerConfig, Type, logging};

use crate::{
    core::{CoreManager, manager::RunningMode, service},
    utils::dirs,
};

pub use clash_verge_logging::Logger;

const fn should_sync_service_writer(running_mode: RunningMode) -> bool {
    matches!(running_mode, RunningMode::Service)
}

async fn logger_config() -> Result<LoggerConfig> {
    let (level, max_size, max_count) = {
        let verge_guard = crate::config::Config::verge().await;
        let verge = verge_guard.latest_arc();
        (
            verge.get_log_level(),
            verge.app_log_max_size.unwrap_or(128),
            verge.app_log_max_count.unwrap_or(8),
        )
    };
    Ok(LoggerConfig {
        level,
        max_size_kb: max_size,
        max_count,
        log_dir: dirs::app_logs_dir()?,
        sidecar_log_dir: dirs::sidecar_log_dir()?,
    })
}

/// Initializes the logging stack. The devtools plugin installs its own global
/// subscriber; in that mode only the sidecar writer and panic hook are set up.
pub async fn init() -> Result<()> {
    let cfg = logger_config().await?;
    #[cfg(not(feature = "tauri-dev"))]
    Logger::global().init(&cfg)?;
    Logger::global().init_sidecar(&cfg)?;
    Ok(())
}

pub async fn update_log_config(log_max_size: u64, log_max_count: usize) -> Result<()> {
    Logger::global().update_log_config(log_max_size, log_max_count)?;

    // The service writer is auxiliary to the local logger. Synchronize it only
    // for an active service session and do not roll back local settings on failure.
    if should_sync_service_writer(*CoreManager::global().get_running_mode())
        && let Err(error) = service::update_writer_by_service(&clash_verge_service_ipc::WriterConfig {
            directory: String::new(),
            max_log_size: log_max_size * 1024,
            max_log_files: log_max_count,
        })
        .await
    {
        logging!(warn, Type::Service, "failed to update service writer config: {error:#}");
    }

    Ok(())
}

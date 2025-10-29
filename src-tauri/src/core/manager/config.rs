use super::CoreManager;
use crate::{
    config::*,
    constants::timing,
    core::{handle, validate::CoreConfigValidator},
    logging,
    utils::{dirs, help, logging::Type},
};
use anyhow::{Result, anyhow};
use smartstring::alias::String;
use std::{path::PathBuf, time::Instant};
use tauri_plugin_mihomo::Error as MihomoError;
use tokio::time::{sleep, timeout};

const RELOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const MAX_RELOAD_ATTEMPTS: usize = 3;

impl CoreManager {
    pub async fn use_default_config(&self, error_key: &str, error_msg: &str) -> Result<()> {
        use crate::constants::files::RUNTIME_CONFIG;

        let runtime_path = dirs::app_home_dir()?.join(RUNTIME_CONFIG);
        let clash_config = Config::clash().await.latest_ref().0.clone();

        *Config::runtime().await.draft_mut() = Box::new(IRuntime {
            config: Some(clash_config.clone()),
            exists_keys: vec![],
            chain_logs: Default::default(),
        });

        help::save_yaml(&runtime_path, &clash_config, Some("# Clash Verge Runtime")).await?;
        handle::Handle::notice_message(error_key, error_msg);
        Ok(())
    }

    pub async fn update_config(&self) -> Result<(bool, String)> {
        if handle::Handle::global().is_exiting() {
            return Ok((true, String::new()));
        }

        if !self.should_update_config()? {
            return Ok((true, String::new()));
        }

        let start = Instant::now();

        let _permit = self
            .update_semaphore
            .try_acquire()
            .map_err(|_| anyhow!("Config update already in progress"))?;

        let result = self.perform_config_update().await;

        match &result {
            Ok((success, msg)) => {
                logging!(
                    info,
                    Type::Core,
                    "[ConfigUpdate] Finished (success={}, elapsed={}ms, msg={})",
                    success,
                    start.elapsed().as_millis(),
                    msg
                );
            }
            Err(err) => {
                logging!(
                    error,
                    Type::Core,
                    "[ConfigUpdate] Failed after {}ms: {}",
                    start.elapsed().as_millis(),
                    err
                );
            }
        }

        result
    }

    fn should_update_config(&self) -> Result<bool> {
        let now = Instant::now();
        let mut last = self.last_update.lock();

        if let Some(last_time) = *last
            && now.duration_since(last_time) < timing::CONFIG_UPDATE_DEBOUNCE
        {
            return Ok(false);
        }

        *last = Some(now);
        Ok(true)
    }

    async fn perform_config_update(&self) -> Result<(bool, String)> {
        logging!(debug, Type::Core, "[ConfigUpdate] Pipeline start");
        let total_start = Instant::now();

        let mut stage_timer = Instant::now();
        Config::generate().await?;
        logging!(
            debug,
            Type::Core,
            "[ConfigUpdate] Generation completed in {}ms",
            stage_timer.elapsed().as_millis()
        );

        stage_timer = Instant::now();
        let validation_result = CoreConfigValidator::global().validate_config().await;
        logging!(
            debug,
            Type::Core,
            "[ConfigUpdate] Validation completed in {}ms",
            stage_timer.elapsed().as_millis()
        );

        match validation_result {
            Ok((true, _)) => {
                stage_timer = Instant::now();
                let run_path = Config::generate_file(ConfigType::Run).await?;
                logging!(
                    debug,
                    Type::Core,
                    "[ConfigUpdate] Runtime file generated in {}ms",
                    stage_timer.elapsed().as_millis()
                );
                stage_timer = Instant::now();
                self.apply_config(run_path).await?;
                logging!(
                    debug,
                    Type::Core,
                    "[ConfigUpdate] Core apply completed in {}ms",
                    stage_timer.elapsed().as_millis()
                );
                logging!(
                    debug,
                    Type::Core,
                    "[ConfigUpdate] Pipeline succeeded in {}ms",
                    total_start.elapsed().as_millis()
                );
                Ok((true, String::new()))
            }
            Ok((false, error_msg)) => {
                Config::runtime().await.discard();
                logging!(
                    warn,
                    Type::Core,
                    "[ConfigUpdate] Validation reported failure after {}ms: {}",
                    total_start.elapsed().as_millis(),
                    error_msg
                );
                Ok((false, error_msg))
            }
            Err(e) => {
                Config::runtime().await.discard();
                logging!(
                    error,
                    Type::Core,
                    "[ConfigUpdate] Validation errored after {}ms: {}",
                    total_start.elapsed().as_millis(),
                    e
                );
                Err(e)
            }
        }
    }

    pub async fn put_configs_force(&self, path: PathBuf) -> Result<()> {
        self.apply_config(path).await
    }

    pub(super) async fn apply_config(&self, path: PathBuf) -> Result<()> {
        let path_str = dirs::path_to_str(&path)?;

        let reload_start = Instant::now();
        match self.reload_config_with_retry(path_str).await {
            Ok(_) => {
                Config::runtime().await.apply();
                logging!(
                    debug,
                    Type::Core,
                    "Configuration applied (reload={}ms)",
                    reload_start.elapsed().as_millis()
                );
                Ok(())
            }
            Err(err) => {
                if let Some(mihomo_err) = err
                    .downcast_ref::<MihomoError>()
                    .filter(|mihomo_err| Self::should_restart_on_error(mihomo_err))
                {
                    logging!(
                        warn,
                        Type::Core,
                        "Reload failed after {}ms with retryable error; restarting core: {}",
                        reload_start.elapsed().as_millis(),
                        mihomo_err
                    );
                    return self.retry_with_restart(path_str).await;
                }

                Config::runtime().await.discard();
                logging!(
                    error,
                    Type::Core,
                    "Failed to apply config after {}ms: {}",
                    reload_start.elapsed().as_millis(),
                    err
                );
                Err(anyhow!("Failed to apply config: {}", err))
            }
        }
    }

    async fn retry_with_restart(&self, config_path: &str) -> Result<()> {
        if handle::Handle::global().is_exiting() {
            return Err(anyhow!("Application exiting"));
        }

        logging!(warn, Type::Core, "Restarting core for config reload");
        self.restart_core().await?;
        sleep(timing::CONFIG_RELOAD_DELAY).await;

        self.reload_config_with_retry(config_path).await?;
        Config::runtime().await.apply();
        logging!(info, Type::Core, "Configuration applied after restart");
        Ok(())
    }

    async fn reload_config_with_retry(&self, path: &str) -> Result<()> {
        for attempt in 1..=MAX_RELOAD_ATTEMPTS {
            let attempt_start = Instant::now();
            let reload_future = self.reload_config_once(path);
            match timeout(RELOAD_TIMEOUT, reload_future).await {
                Ok(Ok(())) => {
                    logging!(
                        debug,
                        Type::Core,
                        "reload_config attempt {}/{} succeeded in {}ms",
                        attempt,
                        MAX_RELOAD_ATTEMPTS,
                        attempt_start.elapsed().as_millis()
                    );
                    return Ok(());
                }
                Ok(Err(err)) => {
                    logging!(
                        warn,
                        Type::Core,
                        "reload_config attempt {}/{} failed after {}ms: {}",
                        attempt,
                        MAX_RELOAD_ATTEMPTS,
                        attempt_start.elapsed().as_millis(),
                        err
                    );
                    if attempt == MAX_RELOAD_ATTEMPTS {
                        return Err(anyhow!(
                            "Failed to reload config after {} attempts: {}",
                            attempt,
                            err
                        ));
                    }
                }
                Err(_) => {
                    logging!(
                        warn,
                        Type::Core,
                        "reload_config attempt {}/{} timed out after {:?}",
                        attempt,
                        MAX_RELOAD_ATTEMPTS,
                        RELOAD_TIMEOUT
                    );
                    if attempt == MAX_RELOAD_ATTEMPTS {
                        return Err(anyhow!(
                            "Config reload timed out after {:?} ({} attempts)",
                            RELOAD_TIMEOUT,
                            MAX_RELOAD_ATTEMPTS
                        ));
                    }
                }
            }
        }

        Err(anyhow!(
            "Config reload retry loop exited unexpectedly ({} attempts)",
            MAX_RELOAD_ATTEMPTS
        ))
    }

    async fn reload_config_once(&self, path: &str) -> Result<(), MihomoError> {
        handle::Handle::mihomo()
            .await
            .reload_config(true, path)
            .await
    }

    fn should_restart_on_error(err: &MihomoError) -> bool {
        match err {
            MihomoError::ConnectionFailed | MihomoError::ConnectionLost => true,
            MihomoError::Io(io_err) => Self::is_connection_io_error(io_err.kind()),
            MihomoError::Reqwest(req_err) => {
                req_err.is_connect()
                    || req_err.is_timeout()
                    || Self::contains_error_pattern(&req_err.to_string())
            }
            MihomoError::FailedResponse(msg) => Self::contains_error_pattern(msg),
            _ => false,
        }
    }

    fn is_connection_io_error(kind: std::io::ErrorKind) -> bool {
        matches!(
            kind,
            std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::ConnectionRefused
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::NotFound
        )
    }

    fn contains_error_pattern(text: &str) -> bool {
        use crate::constants::error_patterns::CONNECTION_ERRORS;
        CONNECTION_ERRORS.iter().any(|p| text.contains(p))
    }
}

use super::{
    CmdResult,
    core::{
        CONFIG_APPLY_TIMEOUT, CoreUpdateOutcome, REFRESH_TIMEOUT, SAVE_PROFILES_TIMEOUT,
        SWITCH_IDLE_WAIT_MAX_BACKOFF, SWITCH_IDLE_WAIT_POLL, SWITCH_IDLE_WAIT_TIMEOUT, StaleStage,
        SwitchState, SwitchStateMachine, TRAY_UPDATE_TIMEOUT,
    },
    restore_previous_profile, validate_profile_yaml,
};
use crate::{
    config::{Config, profiles::profiles_save_file_safe},
    core::{CoreManager, handle, tray::Tray},
    logging,
    process::AsyncHandler,
    utils::logging::Type,
};
use anyhow::Error;
use futures::future;
use smartstring::alias::String as SmartString;
use std::{
    pin::Pin,
    time::{Duration, Instant},
};
use tokio::time;

impl SwitchStateMachine {
    pub(super) fn handle_start(&mut self) -> CmdResult<SwitchState> {
        if self.ctx.manager.is_switching() {
            logging!(
                info,
                Type::Cmd,
                "Profile switch already in progress; queuing request for task={:?}, profile={}",
                self.ctx.task_id,
                self.ctx.profile_label
            );
        }
        Ok(SwitchState::AcquireCore)
    }

    /// Grab the core lock, mark the manager as switching, and compute the target profile.
    pub(super) async fn handle_acquire_core(&mut self) -> CmdResult<SwitchState> {
        let manager = self.ctx.manager;
        let core_guard = manager.core_mutex().lock().await;

        if manager.is_switching() {
            logging!(
                info,
                Type::Cmd,
                "Active profile switch detected; waiting before acquiring scope"
            );
            let wait_start = Instant::now();
            let mut backoff = SWITCH_IDLE_WAIT_POLL;
            while manager.is_switching() {
                if self.ctx.cancelled() {
                    self.ctx
                        .log_cancelled("while waiting for active switch to finish");
                    return Ok(SwitchState::Complete(false));
                }
                if wait_start.elapsed() >= SWITCH_IDLE_WAIT_TIMEOUT {
                    let message = format!(
                        "Timed out after {:?} waiting for active profile switch to finish",
                        SWITCH_IDLE_WAIT_TIMEOUT
                    );
                    logging!(error, Type::Cmd, "{}", message);
                    return Err(message.into());
                }

                time::sleep(backoff).await;
                backoff = backoff.saturating_mul(2).min(SWITCH_IDLE_WAIT_MAX_BACKOFF);
            }
            let waited = wait_start.elapsed().as_millis();
            if waited > 0 {
                logging!(
                    info,
                    Type::Cmd,
                    "Waited {}ms for active switch to finish before acquiring scope",
                    waited
                );
            }
        }

        self.ctx.core_guard = Some(core_guard);
        self.ctx.switch_scope = Some(manager.begin_switch());
        self.ctx.sequence = Some(manager.next_request_sequence());
        self.ctx.ensure_target_profile();

        logging!(
            info,
            Type::Cmd,
            "Begin modifying configuration; sequence: {}, target profile: {:?}",
            self.ctx.sequence(),
            self.ctx.target_profile
        );

        if self.ctx.cancelled() {
            self.ctx.log_cancelled("after acquiring core lock");
            return Ok(SwitchState::Complete(false));
        }

        if self.ctx.stale() {
            StaleStage::AfterLock.log(&self.ctx);
            return Ok(SwitchState::Complete(false));
        }

        Ok(SwitchState::Prepare)
    }

    pub(super) async fn handle_prepare(&mut self) -> CmdResult<SwitchState> {
        let current_profile = {
            let profiles_guard = Config::profiles().await;
            profiles_guard.latest_ref().current.clone()
        };

        logging!(info, Type::Cmd, "Current profile: {:?}", current_profile);
        self.ctx.previous_profile = current_profile;
        Ok(SwitchState::ValidateTarget)
    }

    pub(super) async fn handle_validate_target(&mut self) -> CmdResult<SwitchState> {
        if self.ctx.cancelled() {
            self.ctx.log_cancelled("before validation");
            return Ok(SwitchState::Complete(false));
        }

        if self.ctx.should_validate_target() {
            let Some(target) = self.ctx.target_profile.clone() else {
                logging!(
                    error,
                    Type::Cmd,
                    "Missing target profile while validation was requested; aborting switch"
                );
                return Err("missing target profile at validation".into());
            };
            if !validate_profile_yaml(&target).await? {
                return Ok(SwitchState::Complete(false));
            }
        }

        if self.ctx.stale() {
            StaleStage::BeforeCoreOperation.log(&self.ctx);
            return Ok(SwitchState::Complete(false));
        }

        Ok(SwitchState::PatchDraft)
    }

    pub(super) async fn handle_patch_draft(&mut self) -> CmdResult<SwitchState> {
        if self.ctx.cancelled() {
            self.ctx.log_cancelled("before patching configuration");
            return Ok(SwitchState::Complete(false));
        }

        logging!(
            info,
            Type::Cmd,
            "Updating configuration draft, sequence: {}",
            self.ctx.sequence()
        );

        let patch = self.ctx.take_profiles_patch()?;
        self.ctx.new_profile_for_event = patch.current.clone();
        let _ = Config::profiles().await.draft_mut().patch_config(patch);

        if self.ctx.stale() {
            StaleStage::BeforeCoreInteraction.log(&self.ctx);
            Config::profiles().await.discard();
            return Ok(SwitchState::Complete(false));
        }

        Ok(SwitchState::UpdateCore)
    }

    pub(super) async fn handle_update_core(&mut self) -> CmdResult<SwitchState> {
        let sequence = self.ctx.sequence();
        let task_id = self.ctx.task_id;
        let profile = self.ctx.profile_label.clone();
        logging!(
            info,
            Type::Cmd,
            "Starting core configuration update, sequence: {}, task={:?}, profile={}",
            sequence,
            task_id,
            profile
        );

        let heartbeat = self.ctx.heartbeat.clone();
        let start = Instant::now();
        let mut ticker = time::interval(Duration::from_secs(1));
        ticker.set_missed_tick_behavior(time::MissedTickBehavior::Delay);

        let update_future = CoreManager::global().update_config();
        tokio::pin!(update_future);

        let timeout = time::sleep(Duration::from_secs(30));
        tokio::pin!(timeout);

        let cancel_token = self.ctx.cancel_token();
        let mut cancel_notifier: Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
            match cancel_token {
                Some(token) => Box::pin(async move {
                    token.cancelled_future().await;
                }),
                None => Box::pin(future::pending()),
            };

        enum UpdateOutcome {
            Finished(Result<(bool, SmartString), Error>),
            Timeout,
            Cancelled,
        }

        let update_outcome = loop {
            tokio::select! {
                res = &mut update_future => break UpdateOutcome::Finished(res),
                _ = &mut timeout => break UpdateOutcome::Timeout,
                _ = &mut cancel_notifier => break UpdateOutcome::Cancelled,
                _ = ticker.tick() => {
                    let elapsed_ms = start.elapsed().as_millis();
                    heartbeat.touch();
                    match task_id {
                        Some(id) => logging!(
                            debug,
                            Type::Cmd,
                            "Switch task {} (profile={}) UpdateCore still running (elapsed={}ms)",
                            id,
                            profile,
                            elapsed_ms
                        ),
                        None => logging!(
                            debug,
                            Type::Cmd,
                            "Profile patch {} UpdateCore still running (elapsed={}ms)",
                            profile,
                            elapsed_ms
                        ),
                    }
                }
            }
        };

        let elapsed_ms = start.elapsed().as_millis();

        let outcome = match update_outcome {
            UpdateOutcome::Finished(Ok((true, _))) => {
                logging!(
                    info,
                    Type::Cmd,
                    "Core configuration update succeeded in {}ms",
                    elapsed_ms
                );
                CoreUpdateOutcome::Success
            }
            UpdateOutcome::Finished(Ok((false, msg))) => {
                logging!(
                    warn,
                    Type::Cmd,
                    "Core configuration update validation failed in {}ms: {}",
                    elapsed_ms,
                    msg
                );
                CoreUpdateOutcome::ValidationFailed {
                    message: msg.to_string(),
                }
            }
            UpdateOutcome::Finished(Err(err)) => {
                logging!(
                    error,
                    Type::Cmd,
                    "Core configuration update errored in {}ms: {}",
                    elapsed_ms,
                    err
                );
                CoreUpdateOutcome::CoreError {
                    message: err.to_string(),
                }
            }
            UpdateOutcome::Timeout => {
                logging!(
                    error,
                    Type::Cmd,
                    "Core configuration update timed out after {}ms",
                    elapsed_ms
                );
                CoreUpdateOutcome::Timeout
            }
            UpdateOutcome::Cancelled => {
                self.ctx.log_cancelled("during core update");
                logging!(
                    info,
                    Type::Cmd,
                    "Core configuration update cancelled after {}ms",
                    elapsed_ms
                );
                self.ctx.release_locks();
                Config::profiles().await.discard();
                return Ok(SwitchState::Complete(false));
            }
        };

        self.ctx.release_core_guard();

        Ok(SwitchState::Finalize(outcome))
    }

    pub(super) async fn handle_finalize(
        &mut self,
        outcome: CoreUpdateOutcome,
    ) -> CmdResult<SwitchState> {
        let next_state = match outcome {
            CoreUpdateOutcome::Success => self.finalize_success().await,
            CoreUpdateOutcome::ValidationFailed { message } => {
                self.finalize_validation_failed(message).await
            }
            CoreUpdateOutcome::CoreError { message } => self.finalize_core_error(message).await,
            CoreUpdateOutcome::Timeout => self.finalize_timeout().await,
        };

        if next_state.is_err() || matches!(next_state, Ok(SwitchState::Complete(_))) {
            self.ctx.release_switch_scope();
        }

        next_state
    }

    pub(super) async fn finalize_success(&mut self) -> CmdResult<SwitchState> {
        if self.abort_if_stale_post_core().await? {
            return Ok(SwitchState::Complete(false));
        }

        self.log_successful_update();

        if !self.apply_config_with_timeout().await? {
            logging!(
                warn,
                Type::Cmd,
                "Apply step failed; attempting to restore previous profile before completing"
            );
            restore_previous_profile(self.ctx.previous_profile.clone()).await?;
            return Ok(SwitchState::Complete(false));
        }

        self.refresh_clash_with_timeout().await;
        self.update_tray_tooltip_with_timeout().await;
        self.update_tray_menu_with_timeout().await;
        if let Err(err) = self.persist_profiles_with_timeout().await {
            logging!(
                error,
                Type::Cmd,
                "Persisting new profile configuration failed; attempting to restore previous profile: {}",
                err
            );
            restore_previous_profile(self.ctx.previous_profile.clone()).await?;
            return Err(err);
        }
        self.emit_profile_change_event();
        logging!(
            debug,
            Type::Cmd,
            "Finalize success pipeline completed for sequence {}",
            self.ctx.sequence()
        );

        Ok(SwitchState::Complete(true))
    }

    pub(super) async fn finalize_validation_failed(
        &mut self,
        message: String,
    ) -> CmdResult<SwitchState> {
        logging!(
            warn,
            Type::Cmd,
            "Configuration validation failed: {}",
            message
        );
        Config::profiles().await.discard();
        restore_previous_profile(self.ctx.previous_profile.clone()).await?;
        handle::Handle::notice_message("config_validate::error", message);
        Ok(SwitchState::Complete(false))
    }

    pub(super) async fn finalize_core_error(&mut self, message: String) -> CmdResult<SwitchState> {
        logging!(
            warn,
            Type::Cmd,
            "Error occurred during update: {}, sequence: {}",
            message,
            self.ctx.sequence()
        );
        Config::profiles().await.discard();
        handle::Handle::notice_message("config_validate::boot_error", message);
        Ok(SwitchState::Complete(false))
    }

    pub(super) async fn finalize_timeout(&mut self) -> CmdResult<SwitchState> {
        let timeout_msg =
            "Configuration update timed out (30s); possible validation or core communication stall";
        logging!(
            error,
            Type::Cmd,
            "{}, sequence: {}",
            timeout_msg,
            self.ctx.sequence()
        );
        Config::profiles().await.discard();
        restore_previous_profile(self.ctx.previous_profile.clone()).await?;
        handle::Handle::notice_message("config_validate::timeout", timeout_msg);
        Ok(SwitchState::Complete(false))
    }

    pub(super) async fn abort_if_stale_post_core(&mut self) -> CmdResult<bool> {
        if self.ctx.stale() {
            StaleStage::AfterCoreOperation.log(&self.ctx);
            Config::profiles().await.discard();
            return Ok(true);
        }

        Ok(false)
    }

    pub(super) fn log_successful_update(&self) {
        logging!(
            info,
            Type::Cmd,
            "Configuration update succeeded, sequence: {}",
            self.ctx.sequence()
        );
    }

    pub(super) async fn apply_config_with_timeout(&mut self) -> CmdResult<bool> {
        let apply_result = time::timeout(CONFIG_APPLY_TIMEOUT, async {
            Config::profiles().await.apply()
        })
        .await;

        if apply_result.is_ok() {
            Ok(true)
        } else {
            logging!(
                warn,
                Type::Cmd,
                "Applying profile configuration timed out after {:?}",
                CONFIG_APPLY_TIMEOUT
            );
            Config::profiles().await.discard();
            Ok(false)
        }
    }

    pub(super) async fn refresh_clash_with_timeout(&self) {
        let start = Instant::now();
        let result = time::timeout(REFRESH_TIMEOUT, async {
            handle::Handle::refresh_clash();
        })
        .await;

        let elapsed = start.elapsed().as_millis();
        match result {
            Ok(_) => logging!(
                debug,
                Type::Cmd,
                "refresh_clash_with_timeout completed in {}ms",
                elapsed
            ),
            Err(_) => logging!(
                warn,
                Type::Cmd,
                "Refreshing Clash state timed out after {:?} (elapsed={}ms)",
                REFRESH_TIMEOUT,
                elapsed
            ),
        }
    }

    pub(super) async fn update_tray_tooltip_with_timeout(&self) {
        let start = Instant::now();
        let update_tooltip = time::timeout(TRAY_UPDATE_TIMEOUT, async {
            Tray::global().update_tooltip().await
        })
        .await;
        let elapsed = start.elapsed().as_millis();

        if update_tooltip.is_err() {
            logging!(
                warn,
                Type::Cmd,
                "Updating tray tooltip timed out after {:?} (elapsed={}ms)",
                TRAY_UPDATE_TIMEOUT,
                elapsed
            );
        } else if let Ok(Err(err)) = update_tooltip {
            logging!(
                warn,
                Type::Cmd,
                "Failed to update tray tooltip asynchronously: {}",
                err
            );
        } else {
            logging!(
                debug,
                Type::Cmd,
                "update_tray_tooltip_with_timeout completed in {}ms",
                elapsed
            );
        }
    }

    pub(super) async fn update_tray_menu_with_timeout(&self) {
        let start = Instant::now();
        let update_menu = time::timeout(TRAY_UPDATE_TIMEOUT, async {
            Tray::global().update_menu().await
        })
        .await;
        let elapsed = start.elapsed().as_millis();

        if update_menu.is_err() {
            logging!(
                warn,
                Type::Cmd,
                "Updating tray menu timed out after {:?} (elapsed={}ms)",
                TRAY_UPDATE_TIMEOUT,
                elapsed
            );
        } else if let Ok(Err(err)) = update_menu {
            logging!(
                warn,
                Type::Cmd,
                "Failed to update tray menu asynchronously: {}",
                err
            );
        } else {
            logging!(
                debug,
                Type::Cmd,
                "update_tray_menu_with_timeout completed in {}ms",
                elapsed
            );
        }
    }

    pub(super) async fn persist_profiles_with_timeout(&self) -> CmdResult<()> {
        let start = Instant::now();
        let save_future = AsyncHandler::spawn_blocking(|| {
            futures::executor::block_on(async { profiles_save_file_safe().await })
        });

        let elapsed = start.elapsed().as_millis();
        match time::timeout(SAVE_PROFILES_TIMEOUT, save_future).await {
            Err(_) => {
                let message = format!(
                    "Persisting configuration file timed out after {:?} (elapsed={}ms)",
                    SAVE_PROFILES_TIMEOUT, elapsed
                );
                logging!(warn, Type::Cmd, "{}", message);
                Err(message.into())
            }
            Ok(join_result) => match join_result {
                Err(join_err) => {
                    let message = format!(
                        "Persisting configuration file failed: blocking task join error: {join_err}"
                    );
                    logging!(error, Type::Cmd, "{}", message);
                    Err(message.into())
                }
                Ok(save_result) => match save_result {
                    Ok(()) => {
                        logging!(
                            debug,
                            Type::Cmd,
                            "persist_profiles_with_timeout completed in {}ms",
                            elapsed
                        );
                        Ok(())
                    }
                    Err(err) => {
                        let message = format!("Persisting configuration file failed: {}", err);
                        logging!(error, Type::Cmd, "{}", message);
                        Err(message.into())
                    }
                },
            },
        }
    }

    pub(super) fn emit_profile_change_event(&self) {
        if let Some(current) = self.ctx.new_profile_for_event.clone() {
            logging!(
                info,
                Type::Cmd,
                "Emitting configuration change event to frontend: {}, sequence: {}",
                current,
                self.ctx.sequence()
            );
            handle::Handle::notify_profile_changed(current);
        }
    }
}

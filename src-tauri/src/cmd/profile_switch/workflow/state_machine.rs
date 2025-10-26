use super::{CmdResult, restore_previous_profile, validate_profile_yaml};
use crate::{
    cmd::profile_switch::state::{SwitchManager, SwitchRequest, SwitchScope},
    config::{Config, IProfiles, profiles::profiles_save_file_safe},
    core::{CoreManager, handle, tray::Tray},
    logging,
    utils::logging::Type,
};
use smartstring::alias::String as SmartString;
use std::{mem, time::Duration};
use tokio::{sync::MutexGuard, time};

/// Explicit state machine for profile switching so we can reason about
/// cancellation, stale requests, and side-effects at each stage.
pub(super) struct SwitchStateMachine {
    ctx: SwitchContext,
    state: SwitchState,
}

impl SwitchStateMachine {
    pub(super) fn new(
        manager: &'static SwitchManager,
        request: Option<SwitchRequest>,
        profiles: IProfiles,
    ) -> Self {
        Self {
            ctx: SwitchContext::new(manager, request, profiles),
            state: SwitchState::Start,
        }
    }

    pub(super) async fn run(mut self) -> CmdResult<bool> {
        loop {
            let current_state = mem::replace(&mut self.state, SwitchState::Complete(false));
            let next = match current_state {
                SwitchState::Start => self.handle_start(),
                SwitchState::AcquireCore => self.handle_acquire_core().await,
                SwitchState::Prepare => self.handle_prepare().await,
                SwitchState::ValidateTarget => self.handle_validate_target().await,
                SwitchState::PatchDraft => self.handle_patch_draft().await,
                SwitchState::UpdateCore => self.handle_update_core().await,
                SwitchState::Finalize(outcome) => self.handle_finalize(outcome).await,
                SwitchState::Complete(result) => return Ok(result),
            }?;
            self.state = next;
        }
    }

    fn handle_start(&mut self) -> CmdResult<SwitchState> {
        if self.ctx.manager.is_switching() {
            logging!(
                info,
                Type::Cmd,
                "Profile switch already in progress; skipping request"
            );
            return Ok(SwitchState::Complete(false));
        }
        Ok(SwitchState::AcquireCore)
    }

    async fn handle_acquire_core(&mut self) -> CmdResult<SwitchState> {
        self.ctx.core_guard = Some(self.ctx.manager.core_mutex().lock().await);
        self.ctx.switch_scope = Some(self.ctx.manager.begin_switch());
        self.ctx.sequence = Some(self.ctx.manager.next_request_sequence());
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

    async fn handle_prepare(&mut self) -> CmdResult<SwitchState> {
        let current_profile = {
            let profiles_guard = Config::profiles().await;
            profiles_guard.latest_ref().current.clone()
        };

        logging!(info, Type::Cmd, "Current profile: {:?}", current_profile);
        self.ctx.previous_profile = current_profile;
        Ok(SwitchState::ValidateTarget)
    }

    async fn handle_validate_target(&mut self) -> CmdResult<SwitchState> {
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

    async fn handle_patch_draft(&mut self) -> CmdResult<SwitchState> {
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

        let patch = self
            .ctx
            .take_profiles_patch()
            .ok_or_else(|| "profiles patch already consumed".to_string())?;
        self.ctx.new_profile_for_event = patch.current.clone();
        let _ = Config::profiles().await.draft_mut().patch_config(patch);

        if self.ctx.stale() {
            StaleStage::BeforeCoreInteraction.log(&self.ctx);
            Config::profiles().await.discard();
            return Ok(SwitchState::Complete(false));
        }

        Ok(SwitchState::UpdateCore)
    }

    async fn handle_update_core(&mut self) -> CmdResult<SwitchState> {
        logging!(
            info,
            Type::Cmd,
            "Starting core configuration update, sequence: {}",
            self.ctx.sequence()
        );

        let update_result = time::timeout(
            Duration::from_secs(30),
            CoreManager::global().update_config(),
        )
        .await;

        let outcome = match update_result {
            Ok(Ok((true, _))) => CoreUpdateOutcome::Success,
            Ok(Ok((false, msg))) => CoreUpdateOutcome::ValidationFailed {
                message: msg.to_string(),
            },
            Ok(Err(err)) => CoreUpdateOutcome::CoreError {
                message: err.to_string(),
            },
            Err(_) => CoreUpdateOutcome::Timeout,
        };

        Ok(SwitchState::Finalize(outcome))
    }

    async fn handle_finalize(&mut self, outcome: CoreUpdateOutcome) -> CmdResult<SwitchState> {
        match outcome {
            CoreUpdateOutcome::Success => {
                if self.ctx.stale() {
                    StaleStage::AfterCoreOperation.log(&self.ctx);
                    Config::profiles().await.discard();
                    return Ok(SwitchState::Complete(false));
                }

                logging!(
                    info,
                    Type::Cmd,
                    "Configuration update succeeded, sequence: {}",
                    self.ctx.sequence()
                );
                Config::profiles().await.apply();
                handle::Handle::refresh_clash();

                if let Err(err) = Tray::global().update_tooltip().await {
                    logging!(
                        warn,
                        Type::Cmd,
                        "Failed to update tray tooltip asynchronously: {}",
                        err
                    );
                }

                if let Err(err) = Tray::global().update_menu().await {
                    logging!(
                        warn,
                        Type::Cmd,
                        "Failed to update tray menu asynchronously: {}",
                        err
                    );
                }

                if let Err(err) = profiles_save_file_safe().await {
                    logging!(
                        warn,
                        Type::Cmd,
                        "Failed to persist configuration file asynchronously: {}",
                        err
                    );
                }

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

                Ok(SwitchState::Complete(true))
            }
            CoreUpdateOutcome::ValidationFailed { message } => {
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
            CoreUpdateOutcome::CoreError { message } => {
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
            CoreUpdateOutcome::Timeout => {
                let timeout_msg = "Configuration update timed out (30s); possible validation or core communication stall";
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
        }
    }
}

struct SwitchContext {
    manager: &'static SwitchManager,
    request: Option<SwitchRequest>,
    profiles_patch: Option<IProfiles>,
    sequence: Option<u64>,
    target_profile: Option<SmartString>,
    previous_profile: Option<SmartString>,
    new_profile_for_event: Option<SmartString>,
    switch_scope: Option<SwitchScope<'static>>,
    core_guard: Option<MutexGuard<'static, ()>>,
}

impl SwitchContext {
    fn new(
        manager: &'static SwitchManager,
        request: Option<SwitchRequest>,
        profiles: IProfiles,
    ) -> Self {
        Self {
            manager,
            request,
            profiles_patch: Some(profiles),
            sequence: None,
            target_profile: None,
            previous_profile: None,
            new_profile_for_event: None,
            switch_scope: None,
            core_guard: None,
        }
    }

    fn ensure_target_profile(&mut self) {
        if let Some(patch) = self.profiles_patch.as_mut() {
            if patch.current.is_none()
                && let Some(request) = self.request.as_ref()
            {
                patch.current = Some(request.profile_id().clone());
            }
            self.target_profile = patch.current.clone();
        }
    }

    fn take_profiles_patch(&mut self) -> Option<IProfiles> {
        self.profiles_patch.take()
    }

    fn cancelled(&self) -> bool {
        self.request
            .as_ref()
            .map(|req| req.cancel_token().is_cancelled())
            .unwrap_or(false)
    }

    fn log_cancelled(&self, stage: &str) {
        if let Some(request) = self.request.as_ref() {
            logging!(
                info,
                Type::Cmd,
                "Switch task {} cancelled {}; profile={}",
                request.task_id(),
                stage,
                request.profile_id()
            );
        } else {
            logging!(info, Type::Cmd, "Profile switch cancelled {}", stage);
        }
    }

    fn should_validate_target(&self) -> bool {
        match (&self.target_profile, &self.previous_profile) {
            (Some(target), Some(current)) => current != target,
            (Some(_), None) => true,
            _ => false,
        }
    }

    fn stale(&self) -> bool {
        self.sequence
            .map(|seq| seq < self.manager.latest_request_sequence())
            .unwrap_or(false)
    }

    fn sequence(&self) -> u64 {
        match self.sequence {
            Some(sequence) => sequence,
            None => {
                logging!(
                    warn,
                    Type::Cmd,
                    "Sequence unexpectedly missing in switch context; defaulting to 0"
                );
                0
            }
        }
    }
}

enum SwitchState {
    Start,
    AcquireCore,
    Prepare,
    ValidateTarget,
    PatchDraft,
    UpdateCore,
    Finalize(CoreUpdateOutcome),
    Complete(bool),
}

enum CoreUpdateOutcome {
    Success,
    ValidationFailed { message: String },
    CoreError { message: String },
    Timeout,
}

enum StaleStage {
    AfterLock,
    BeforeCoreOperation,
    BeforeCoreInteraction,
    AfterCoreOperation,
}

impl StaleStage {
    fn log(&self, ctx: &SwitchContext) {
        let sequence = ctx.sequence();
        let latest = ctx.manager.latest_request_sequence();
        match self {
            StaleStage::AfterLock => logging!(
                info,
                Type::Cmd,
                "Detected a newer request after acquiring the lock (sequence: {} < {}), abandoning current request",
                sequence,
                latest
            ),
            StaleStage::BeforeCoreOperation => logging!(
                info,
                Type::Cmd,
                "Detected a newer request before core operation (sequence: {} < {}), abandoning current request",
                sequence,
                latest
            ),
            StaleStage::BeforeCoreInteraction => logging!(
                info,
                Type::Cmd,
                "Detected a newer request before core interaction (sequence: {} < {}), abandoning current request",
                sequence,
                latest
            ),
            StaleStage::AfterCoreOperation => logging!(
                info,
                Type::Cmd,
                "Detected a newer request after core operation (sequence: {} < {}), ignoring current result",
                sequence,
                latest
            ),
        }
    }
}

impl Drop for SwitchContext {
    fn drop(&mut self) {
        self.core_guard.take();
        self.switch_scope.take();
    }
}

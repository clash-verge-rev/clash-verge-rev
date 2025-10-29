use super::{CmdResult, describe_panic_payload, restore_previous_profile, validate_profile_yaml};
use crate::{
    cmd::profile_switch::state::{
        SwitchCancellation, SwitchHeartbeat, SwitchManager, SwitchRequest, SwitchScope,
    },
    config::{Config, IProfiles, profiles::profiles_save_file_safe},
    core::{CoreManager, handle, tray::Tray},
    logging,
    process::AsyncHandler,
    utils::logging::Type,
};
use anyhow::Error;
use futures::{FutureExt, future};
use smartstring::alias::String as SmartString;
use std::{
    mem,
    panic::AssertUnwindSafe,
    pin::Pin,
    time::{Duration, Instant},
};
use tokio::{sync::MutexGuard, time};

pub(super) const CONFIG_APPLY_TIMEOUT: Duration = Duration::from_secs(5);
const TRAY_UPDATE_TIMEOUT: Duration = Duration::from_secs(3);
const REFRESH_TIMEOUT: Duration = Duration::from_secs(3);
pub(super) const SAVE_PROFILES_TIMEOUT: Duration = Duration::from_secs(5);

/// Explicit state machine for profile switching so we can reason about
/// cancellation, stale requests, and side effects at each stage.
pub(super) struct SwitchStateMachine {
    ctx: SwitchContext,
    state: SwitchState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SwitchStage {
    Start,
    AcquireCore,
    Prepare,
    ValidateTarget,
    PatchDraft,
    UpdateCore,
    Finalize,
    Workflow,
    DriverTask,
}

impl SwitchStage {
    pub(crate) fn as_code(self) -> u32 {
        match self {
            SwitchStage::Start => 0,
            SwitchStage::AcquireCore => 1,
            SwitchStage::Prepare => 2,
            SwitchStage::ValidateTarget => 3,
            SwitchStage::PatchDraft => 4,
            SwitchStage::UpdateCore => 5,
            SwitchStage::Finalize => 6,
            SwitchStage::Workflow => 7,
            SwitchStage::DriverTask => 8,
        }
    }

    pub(crate) fn from_code(code: u32) -> Option<Self> {
        Some(match code {
            0 => SwitchStage::Start,
            1 => SwitchStage::AcquireCore,
            2 => SwitchStage::Prepare,
            3 => SwitchStage::ValidateTarget,
            4 => SwitchStage::PatchDraft,
            5 => SwitchStage::UpdateCore,
            6 => SwitchStage::Finalize,
            7 => SwitchStage::Workflow,
            8 => SwitchStage::DriverTask,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SwitchPanicInfo {
    pub(crate) stage: SwitchStage,
    pub(crate) detail: String,
}

impl SwitchPanicInfo {
    pub(crate) fn new(stage: SwitchStage, detail: String) -> Self {
        Self { stage, detail }
    }

    pub(crate) fn workflow_root(detail: String) -> Self {
        Self::new(SwitchStage::Workflow, detail)
    }

    pub(crate) fn driver_task(detail: String) -> Self {
        Self::new(SwitchStage::DriverTask, detail)
    }
}

impl SwitchStateMachine {
    pub(super) fn new(
        manager: &'static SwitchManager,
        request: Option<SwitchRequest>,
        profiles: IProfiles,
    ) -> Self {
        let heartbeat = request
            .as_ref()
            .map(|req| req.heartbeat().clone())
            .unwrap_or_else(SwitchHeartbeat::new);

        Self {
            ctx: SwitchContext::new(manager, request, profiles, heartbeat),
            state: SwitchState::Start,
        }
    }

    pub(super) async fn run(mut self) -> Result<CmdResult<bool>, SwitchPanicInfo> {
        loop {
            let current_state = mem::replace(&mut self.state, SwitchState::Complete(false));
            match current_state {
                SwitchState::Complete(result) => return Ok(Ok(result)),
                _ => match self.run_state(current_state).await? {
                    Ok(state) => self.state = state,
                    Err(err) => return Ok(Err(err)),
                },
            }
        }
    }

    async fn run_state(
        &mut self,
        current: SwitchState,
    ) -> Result<CmdResult<SwitchState>, SwitchPanicInfo> {
        match current {
            SwitchState::Start => {
                self.with_stage(
                    SwitchStage::Start,
                    |this| async move { this.handle_start() },
                )
                .await
            }
            SwitchState::AcquireCore => {
                self.with_stage(SwitchStage::AcquireCore, |this| async move {
                    this.handle_acquire_core().await
                })
                .await
            }
            SwitchState::Prepare => {
                self.with_stage(SwitchStage::Prepare, |this| async move {
                    this.handle_prepare().await
                })
                .await
            }
            SwitchState::ValidateTarget => {
                self.with_stage(SwitchStage::ValidateTarget, |this| async move {
                    this.handle_validate_target().await
                })
                .await
            }
            SwitchState::PatchDraft => {
                self.with_stage(SwitchStage::PatchDraft, |this| async move {
                    this.handle_patch_draft().await
                })
                .await
            }
            SwitchState::UpdateCore => {
                self.with_stage(SwitchStage::UpdateCore, |this| async move {
                    this.handle_update_core().await
                })
                .await
            }
            SwitchState::Finalize(outcome) => {
                self.with_stage(SwitchStage::Finalize, |this| async move {
                    this.handle_finalize(outcome).await
                })
                .await
            }
            SwitchState::Complete(result) => Ok(Ok(SwitchState::Complete(result))),
        }
    }

    async fn with_stage<'a, F, Fut>(
        &'a mut self,
        stage: SwitchStage,
        f: F,
    ) -> Result<CmdResult<SwitchState>, SwitchPanicInfo>
    where
        F: FnOnce(&'a mut Self) -> Fut,
        Fut: std::future::Future<Output = CmdResult<SwitchState>> + 'a,
    {
        self.ctx.record_stage(stage);
        AssertUnwindSafe(f(self))
            .catch_unwind()
            .await
            .map_err(|payload| {
                SwitchPanicInfo::new(stage, describe_panic_payload(payload.as_ref()))
            })
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

    async fn handle_update_core(&mut self) -> CmdResult<SwitchState> {
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

        self.ctx.release_locks();

        Ok(SwitchState::Finalize(outcome))
    }

    async fn handle_finalize(&mut self, outcome: CoreUpdateOutcome) -> CmdResult<SwitchState> {
        match outcome {
            CoreUpdateOutcome::Success => self.finalize_success().await,
            CoreUpdateOutcome::ValidationFailed { message } => {
                self.finalize_validation_failed(message).await
            }
            CoreUpdateOutcome::CoreError { message } => self.finalize_core_error(message).await,
            CoreUpdateOutcome::Timeout => self.finalize_timeout().await,
        }
    }

    async fn finalize_success(&mut self) -> CmdResult<SwitchState> {
        if self.abort_if_stale_post_core().await? {
            return Ok(SwitchState::Complete(false));
        }

        self.log_successful_update();

        if !self.apply_config_with_timeout().await? {
            return Ok(SwitchState::Complete(false));
        }

        self.refresh_clash_with_timeout().await;
        self.update_tray_tooltip_with_timeout().await;
        self.update_tray_menu_with_timeout().await;
        self.persist_profiles_with_timeout().await;
        self.emit_profile_change_event();
        logging!(
            debug,
            Type::Cmd,
            "Finalize success pipeline completed for sequence {}",
            self.ctx.sequence()
        );

        Ok(SwitchState::Complete(true))
    }

    async fn finalize_validation_failed(&mut self, message: String) -> CmdResult<SwitchState> {
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

    async fn finalize_core_error(&mut self, message: String) -> CmdResult<SwitchState> {
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

    async fn finalize_timeout(&mut self) -> CmdResult<SwitchState> {
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

    async fn abort_if_stale_post_core(&mut self) -> CmdResult<bool> {
        if self.ctx.stale() {
            StaleStage::AfterCoreOperation.log(&self.ctx);
            Config::profiles().await.discard();
            return Ok(true);
        }

        Ok(false)
    }

    fn log_successful_update(&self) {
        logging!(
            info,
            Type::Cmd,
            "Configuration update succeeded, sequence: {}",
            self.ctx.sequence()
        );
    }

    async fn apply_config_with_timeout(&mut self) -> CmdResult<bool> {
        let apply_result = time::timeout(CONFIG_APPLY_TIMEOUT, async {
            AsyncHandler::spawn_blocking(|| {
                futures::executor::block_on(async {
                    Config::profiles().await.apply();
                });
            })
            .await
        })
        .await;

        if apply_result.is_ok() {
            return Ok(true);
        }

        logging!(
            warn,
            Type::Cmd,
            "Applying profile configuration timed out after {:?}",
            CONFIG_APPLY_TIMEOUT
        );
        Config::profiles().await.discard();
        Ok(false)
    }

    async fn refresh_clash_with_timeout(&self) {
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

    async fn update_tray_tooltip_with_timeout(&self) {
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

    async fn update_tray_menu_with_timeout(&self) {
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

    async fn persist_profiles_with_timeout(&self) {
        let start = Instant::now();
        let save_future = AsyncHandler::spawn_blocking(|| {
            futures::executor::block_on(async { profiles_save_file_safe().await })
        });

        let result = time::timeout(SAVE_PROFILES_TIMEOUT, save_future).await;
        let elapsed = start.elapsed().as_millis();

        if result.is_err() {
            logging!(
                warn,
                Type::Cmd,
                "Persisting configuration file timed out after {:?} (elapsed={}ms)",
                SAVE_PROFILES_TIMEOUT,
                elapsed
            );
        } else {
            logging!(
                debug,
                Type::Cmd,
                "persist_profiles_with_timeout completed in {}ms",
                elapsed
            );
        }
    }

    fn emit_profile_change_event(&self) {
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
    heartbeat: SwitchHeartbeat,
    task_id: Option<u64>,
    profile_label: SmartString,
    active_stage: SwitchStage,
}

impl SwitchContext {
    fn new(
        manager: &'static SwitchManager,
        request: Option<SwitchRequest>,
        profiles: IProfiles,
        heartbeat: SwitchHeartbeat,
    ) -> Self {
        let task_id = request.as_ref().map(|req| req.task_id());
        let profile_label = request
            .as_ref()
            .map(|req| req.profile_id().clone())
            .or_else(|| profiles.current.clone())
            .unwrap_or_else(|| SmartString::from("unknown"));
        heartbeat.touch();
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
            heartbeat,
            task_id,
            profile_label,
            active_stage: SwitchStage::Start,
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

    fn take_profiles_patch(&mut self) -> CmdResult<IProfiles> {
        self.profiles_patch
            .take()
            .ok_or_else(|| "profiles patch already consumed".into())
    }

    fn cancel_token(&self) -> Option<SwitchCancellation> {
        self.request.as_ref().map(|req| req.cancel_token().clone())
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
        self.sequence.unwrap_or_else(|| {
            logging!(
                warn,
                Type::Cmd,
                "Sequence unexpectedly missing in switch context; defaulting to 0"
            );
            0
        })
    }

    fn record_stage(&mut self, stage: SwitchStage) {
        let since_last = self.heartbeat.elapsed();
        let previous = self.active_stage;
        self.active_stage = stage;
        self.heartbeat.set_stage(stage.as_code());

        match self.task_id {
            Some(task_id) => logging!(
                debug,
                Type::Cmd,
                "Switch task {} (profile={}) transitioned {:?} -> {:?} after {:?}",
                task_id,
                self.profile_label,
                previous,
                stage,
                since_last
            ),
            None => logging!(
                debug,
                Type::Cmd,
                "Profile patch {} transitioned {:?} -> {:?} after {:?}",
                self.profile_label,
                previous,
                stage,
                since_last
            ),
        }
    }

    fn release_locks(&mut self) {
        self.core_guard = None;
        self.switch_scope = None;
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

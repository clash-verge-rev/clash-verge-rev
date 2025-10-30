use super::{CmdResult, context::SwitchContext, describe_panic_payload};
use crate::{
    cmd::profile_switch::state::{SwitchHeartbeat, SwitchManager, SwitchRequest},
    config::IProfiles,
    logging,
    utils::logging::Type,
};
use futures::FutureExt;
use std::{
    mem,
    panic::AssertUnwindSafe,
    time::{Duration, Instant},
};
pub(crate) const CONFIG_APPLY_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const TRAY_UPDATE_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const REFRESH_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const SAVE_PROFILES_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const SWITCH_IDLE_WAIT_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const SWITCH_IDLE_WAIT_POLL: Duration = Duration::from_millis(25);
pub(crate) const SWITCH_IDLE_WAIT_MAX_BACKOFF: Duration = Duration::from_millis(250);

/// Explicit state machine for profile switching so we can reason about
/// cancellation, stale requests, and side effects at each stage.
pub(crate) struct SwitchStateMachine {
    pub(super) ctx: SwitchContext,
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

/// High-level state machine nodes executed in strict sequence.
pub(crate) enum SwitchState {
    Start,
    AcquireCore,
    Prepare,
    ValidateTarget,
    PatchDraft,
    UpdateCore,
    Finalize(CoreUpdateOutcome),
    Complete(bool),
}

/// Result of trying to apply the draft configuration to the core.
pub(crate) enum CoreUpdateOutcome {
    Success,
    ValidationFailed { message: String },
    CoreError { message: String },
    Timeout,
}

/// Indicates where a stale request was detected so logs stay descriptive.
pub(crate) enum StaleStage {
    AfterLock,
    BeforeCoreOperation,
    BeforeCoreInteraction,
    AfterCoreOperation,
}

impl StaleStage {
    pub(super) fn log(&self, ctx: &SwitchContext) {
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

impl SwitchStateMachine {
    pub(crate) fn new(
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

    pub(crate) async fn run(mut self) -> Result<CmdResult<bool>, SwitchPanicInfo> {
        // Drive the state machine until we either complete successfully or bubble up a panic.
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

    /// Helper that wraps each stage with consistent logging and panic reporting.
    async fn with_stage<'a, F, Fut>(
        &'a mut self,
        stage: SwitchStage,
        f: F,
    ) -> Result<CmdResult<SwitchState>, SwitchPanicInfo>
    where
        F: FnOnce(&'a mut Self) -> Fut,
        Fut: std::future::Future<Output = CmdResult<SwitchState>> + 'a,
    {
        let sequence = self.ctx.sequence();
        let task = self.ctx.task_id;
        let profile = self.ctx.profile_label.clone();
        logging!(
            info,
            Type::Cmd,
            "Enter {:?} (sequence={}, task={:?}, profile={})",
            stage,
            sequence,
            task,
            profile
        );
        let stage_start = Instant::now();
        self.ctx.record_stage(stage);
        AssertUnwindSafe(f(self))
            .catch_unwind()
            .await
            .map_err(|payload| {
                SwitchPanicInfo::new(stage, describe_panic_payload(payload.as_ref()))
            })
            .inspect(|_| {
                logging!(
                    info,
                    Type::Cmd,
                    "Exit {:?} (sequence={}, task={:?}, profile={}, elapsed={}ms)",
                    stage,
                    sequence,
                    task,
                    profile,
                    stage_start.elapsed().as_millis()
                );
            })
    }
}

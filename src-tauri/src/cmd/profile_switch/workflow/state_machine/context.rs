use super::{CmdResult, core::SwitchStage};
use crate::{
    cmd::profile_switch::state::{
        SwitchCancellation, SwitchHeartbeat, SwitchManager, SwitchRequest, SwitchScope,
    },
    config::IProfiles,
    logging,
    utils::logging::Type,
};
use smartstring::alias::String as SmartString;
use tokio::sync::MutexGuard;

pub(super) struct SwitchContext {
    pub(super) manager: &'static SwitchManager,
    pub(super) request: Option<SwitchRequest>,
    pub(super) profiles_patch: Option<IProfiles>,
    pub(super) sequence: Option<u64>,
    pub(super) target_profile: Option<SmartString>,
    pub(super) previous_profile: Option<SmartString>,
    pub(super) new_profile_for_event: Option<SmartString>,
    pub(super) switch_scope: Option<SwitchScope<'static>>,
    pub(super) core_guard: Option<MutexGuard<'static, ()>>,
    pub(super) heartbeat: SwitchHeartbeat,
    pub(super) task_id: Option<u64>,
    pub(super) profile_label: SmartString,
    pub(super) active_stage: SwitchStage,
}

impl SwitchContext {
    // Captures all mutable data required across states (locks, profile ids, etc).
    pub(super) fn new(
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

    pub(super) fn ensure_target_profile(&mut self) {
        // Lazily determine which profile we're switching to so shared paths (patch vs. driver) behave the same.
        if let Some(patch) = self.profiles_patch.as_mut() {
            if patch.current.is_none()
                && let Some(request) = self.request.as_ref()
            {
                patch.current = Some(request.profile_id().clone());
            }
            self.target_profile = patch.current.clone();
        }
    }

    pub(super) fn take_profiles_patch(&mut self) -> CmdResult<IProfiles> {
        self.profiles_patch
            .take()
            .ok_or_else(|| "profiles patch already consumed".into())
    }

    pub(super) fn cancel_token(&self) -> Option<SwitchCancellation> {
        self.request.as_ref().map(|req| req.cancel_token().clone())
    }

    pub(super) fn cancelled(&self) -> bool {
        self.request
            .as_ref()
            .map(|req| req.cancel_token().is_cancelled())
            .unwrap_or(false)
    }

    pub(super) fn log_cancelled(&self, stage: &str) {
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

    pub(super) fn should_validate_target(&self) -> bool {
        match (&self.target_profile, &self.previous_profile) {
            (Some(target), Some(current)) => current != target,
            (Some(_), None) => true,
            _ => false,
        }
    }

    pub(super) fn stale(&self) -> bool {
        self.sequence
            .map(|seq| seq < self.manager.latest_request_sequence())
            .unwrap_or(false)
    }

    pub(super) fn sequence(&self) -> u64 {
        self.sequence.unwrap_or_else(|| {
            logging!(
                warn,
                Type::Cmd,
                "Sequence unexpectedly missing in switch context; defaulting to 0"
            );
            0
        })
    }

    pub(super) fn record_stage(&mut self, stage: SwitchStage) {
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

    pub(super) fn release_core_guard(&mut self) {
        self.core_guard = None;
    }

    pub(super) fn release_switch_scope(&mut self) {
        self.switch_scope = None;
    }

    pub(super) fn release_locks(&mut self) {
        self.release_core_guard();
        self.release_switch_scope();
    }
}

impl Drop for SwitchContext {
    fn drop(&mut self) {
        self.core_guard.take();
        self.switch_scope.take();
    }
}

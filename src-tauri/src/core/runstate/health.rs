//! Run State separates observed Service health from session intent.
//! Core lifecycle remains in `CoreManager`.

use crate::core::manager::RunningMode;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ServiceHealth {
    #[default]
    Unknown,
    Ready,
    NotInstalled,
    VersionMismatch,
    Unavailable(String),
}

impl ServiceHealth {
    const fn kind(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Ready => "ready",
            Self::NotInstalled => "notInstalled",
            Self::VersionMismatch => "versionMismatch",
            Self::Unavailable(_) => "unavailable",
        }
    }

    fn reason(&self) -> Option<String> {
        match self {
            Self::Unavailable(reason) => Some(reason.clone()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingAction {
    Install,
    Uninstall,
    Reinstall,
    ForceReinstall,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunState {
    pub health: ServiceHealth,
    pub pending: Option<PendingAction>,
    pub sidecar_allowed: bool,
    pub mode: RunningMode,
    pub is_admin: bool,
    /// A privileged operation is currently in flight, so `health` may be stale.
    pub op_in_flight: bool,
}

impl RunState {
    #[must_use]
    pub const fn service_ready(&self) -> bool {
        matches!(self.health, ServiceHealth::Ready)
    }

    #[must_use]
    pub const fn service_usable(&self) -> bool {
        self.service_ready() && !self.op_in_flight
    }

    #[must_use]
    pub const fn tun_capable(&self) -> bool {
        self.is_admin || self.service_usable()
    }

    /// In-flight, absent, and accepted-Sidecar states require no user decision.
    #[must_use]
    pub const fn service_needs_attention(&self) -> bool {
        if self.op_in_flight {
            return false;
        }
        if self.pending.is_some() {
            return true;
        }
        if self.sidecar_allowed {
            return false;
        }
        matches!(
            self.health,
            ServiceHealth::VersionMismatch | ServiceHealth::Unavailable(_)
        )
    }

    /// Unknown, in-flight, and attention-required states are inconclusive.
    #[must_use]
    pub const fn tun_should_be_disabled(&self, tun_enabled: bool) -> bool {
        if !tun_enabled || self.tun_capable() {
            return false;
        }
        !matches!(self.health, ServiceHealth::Unknown) && !self.op_in_flight && !self.service_needs_attention()
    }

    /// Present-but-broken services remain in the repair flow rather than suppressing TUN.
    #[must_use]
    pub const fn startup_tun_should_be_disabled(&self, tun_enabled: bool) -> bool {
        matches!(self.health, ServiceHealth::NotInstalled) && self.tun_should_be_disabled(tun_enabled)
    }

    #[must_use]
    pub fn to_view(&self) -> RunStateView {
        RunStateView {
            mode: self.mode,
            service: self.health.kind(),
            service_unavailable_reason: self.health.reason(),
            pending_action: self.pending,
            sidecar_allowed: self.sidecar_allowed,
            is_admin: self.is_admin,
            op_in_flight: self.op_in_flight,
            service_usable: self.service_usable(),
            tun_capable: self.tun_capable(),
            service_needs_attention: self.service_needs_attention(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStateView {
    pub mode: RunningMode,
    pub service: &'static str,
    pub service_unavailable_reason: Option<String>,
    pub pending_action: Option<PendingAction>,
    pub sidecar_allowed: bool,
    pub is_admin: bool,
    pub op_in_flight: bool,
    pub service_usable: bool,
    pub tun_capable: bool,
    pub service_needs_attention: bool,
}

/// Service state protected by one lock.
/// `pending` and `sidecar_allowed` are mutually exclusive.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct StoredService {
    pub health: ServiceHealth,
    pub pending: Option<PendingAction>,
    pub sidecar_allowed: bool,
}

impl StoredService {
    pub fn observe(&mut self, health: ServiceHealth) {
        self.health = health;
        self.pending = None;
        self.sidecar_allowed = false;
    }

    pub const fn request(&mut self, action: PendingAction) {
        self.pending = Some(action);
        self.sidecar_allowed = false;
    }

    pub const fn allow_sidecar(&mut self) {
        self.pending = None;
        self.sidecar_allowed = true;
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;

    fn state(health: ServiceHealth, is_admin: bool, op_in_flight: bool) -> RunState {
        RunState {
            health,
            pending: None,
            sidecar_allowed: false,
            mode: RunningMode::NotRunning,
            is_admin,
            op_in_flight,
        }
    }

    #[test]
    fn a_service_that_is_merely_absent_needs_no_decision() {
        assert!(!state(ServiceHealth::NotInstalled, false, false).service_needs_attention());
        assert!(!state(ServiceHealth::Ready, false, false).service_needs_attention());
        assert!(!state(ServiceHealth::Unknown, false, false).service_needs_attention());
    }

    #[test]
    fn a_present_but_unusable_service_needs_a_decision() {
        assert!(state(ServiceHealth::VersionMismatch, false, false).service_needs_attention());
        assert!(state(ServiceHealth::Unavailable("boom".into()), false, false).service_needs_attention());
    }

    #[test]
    fn a_requested_action_needs_an_answer_until_it_is_being_carried_out() {
        for action in [
            PendingAction::Install,
            PendingAction::Uninstall,
            PendingAction::Reinstall,
            PendingAction::ForceReinstall,
        ] {
            let mut run_state = state(ServiceHealth::NotInstalled, false, false);
            run_state.pending = Some(action);
            assert!(run_state.service_needs_attention(), "{action:?} is still a question");

            run_state.op_in_flight = true;
            assert!(
                !run_state.service_needs_attention(),
                "{action:?} is under way, which is progress rather than a question"
            );
        }
    }

    #[test]
    fn an_operation_under_way_is_never_a_decision_to_put_to_the_user() {
        for health in [
            ServiceHealth::Unknown,
            ServiceHealth::Ready,
            ServiceHealth::NotInstalled,
            ServiceHealth::VersionMismatch,
            ServiceHealth::Unavailable("boom".into()),
        ] {
            let mut run_state = state(health.clone(), false, true);
            run_state.pending = Some(PendingAction::Uninstall);

            assert!(!run_state.service_needs_attention(), "{health:?}");
        }
    }

    #[test]
    fn the_view_carries_the_derived_answers_and_the_unavailable_reason() {
        let mut run_state = state(ServiceHealth::Unavailable("socket refused".into()), true, false);
        run_state.pending = Some(PendingAction::Reinstall);

        let view = run_state.to_view();

        assert_eq!(view.service, "unavailable");
        assert_eq!(view.service_unavailable_reason.as_deref(), Some("socket refused"));
        assert_eq!(view.pending_action, Some(PendingAction::Reinstall));
        assert!(view.tun_capable, "elevation alone makes TUN possible");
        assert!(!view.service_usable);
        assert!(view.service_needs_attention);
    }

    #[test]
    fn a_healthy_view_reports_no_unavailable_reason() {
        let view = state(ServiceHealth::Ready, false, false).to_view();

        assert_eq!(view.service, "ready");
        assert_eq!(view.service_unavailable_reason, None);
        assert!(view.service_usable);
        assert!(!view.service_needs_attention);
    }

    #[test]
    fn tun_is_left_alone_when_the_user_has_not_asked_for_it() {
        assert!(!state(ServiceHealth::NotInstalled, false, false).tun_should_be_disabled(false));
    }

    #[test]
    fn tun_is_left_alone_while_it_still_works() {
        assert!(!state(ServiceHealth::Ready, false, false).tun_should_be_disabled(true));
        assert!(!state(ServiceHealth::NotInstalled, true, false).tun_should_be_disabled(true));
    }

    #[test]
    fn tun_is_disabled_once_we_know_it_cannot_work() {
        assert!(state(ServiceHealth::NotInstalled, false, false).tun_should_be_disabled(true));
    }

    #[test]
    fn startup_tun_is_disabled_only_for_a_confirmed_absent_service() {
        assert!(
            state(ServiceHealth::NotInstalled, false, false).startup_tun_should_be_disabled(true),
            "a non-elevated reinstall must not keep an unusable TUN setting"
        );

        for health in [
            ServiceHealth::Unknown,
            ServiceHealth::Ready,
            ServiceHealth::VersionMismatch,
            ServiceHealth::Unavailable("socket refused".into()),
        ] {
            assert!(
                !state(health.clone(), false, false).startup_tun_should_be_disabled(true),
                "{health:?} is not proof that the Service was removed"
            );
        }
    }

    #[test]
    fn startup_leaves_a_present_but_broken_service_to_the_runtime_reconciler() {
        for health in [
            ServiceHealth::VersionMismatch,
            ServiceHealth::Unavailable("socket refused".into()),
        ] {
            let mut settled = state(health.clone(), false, false);
            settled.sidecar_allowed = true;

            assert!(settled.tun_should_be_disabled(true), "{health:?}");
            assert!(!settled.startup_tun_should_be_disabled(true), "{health:?}");
        }
    }

    #[test]
    fn startup_tun_is_kept_when_disabled_elevated_or_still_undecided() {
        assert!(!state(ServiceHealth::NotInstalled, false, false).startup_tun_should_be_disabled(false));
        assert!(!state(ServiceHealth::NotInstalled, true, false).startup_tun_should_be_disabled(true));
        assert!(!state(ServiceHealth::NotInstalled, false, true).startup_tun_should_be_disabled(true));

        let mut requested = state(ServiceHealth::NotInstalled, false, false);
        requested.pending = Some(PendingAction::Install);
        assert!(
            !requested.startup_tun_should_be_disabled(true),
            "an install the user has still to answer is not a settled absence"
        );
    }

    #[test]
    fn tun_is_never_disabled_while_an_operation_is_in_flight() {
        assert!(!state(ServiceHealth::Ready, false, true).tun_should_be_disabled(true));
        assert!(!state(ServiceHealth::NotInstalled, false, true).tun_should_be_disabled(true));
    }

    #[test]
    fn tun_is_never_disabled_on_an_unprobed_service() {
        assert!(!state(ServiceHealth::Unknown, false, false).tun_should_be_disabled(true));
    }

    #[test]
    fn tun_is_never_disabled_while_a_decision_is_pending() {
        for health in [
            ServiceHealth::VersionMismatch,
            ServiceHealth::Unavailable("boom".into()),
        ] {
            assert!(
                !state(health.clone(), false, false).tun_should_be_disabled(true),
                "{health:?} is the user's to resolve",
            );
        }

        let mut requested = state(ServiceHealth::NotInstalled, false, false);
        requested.pending = Some(PendingAction::Install);
        assert!(!requested.tun_should_be_disabled(true));
    }

    #[test]
    fn tun_is_disabled_once_the_user_settles_on_sidecar() {
        let mut settled = state(ServiceHealth::NotInstalled, false, false);
        settled.sidecar_allowed = true;

        assert!(settled.tun_should_be_disabled(true));
    }
}

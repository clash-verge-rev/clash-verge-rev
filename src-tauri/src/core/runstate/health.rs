//! Run State value types.
//!
//! The central distinction: [`ServiceHealth`] is what we *observed* about the Service,
//! [`PendingAction`] is what this session *asked for*. The legacy `ServiceStatus` enum
//! conflated the two into one slot, which is why narrowing it for the frontend had to be
//! lossy. Nothing narrows now: [`RunStateView`] carries both, plus the derived answers.
//!
//! See `CONTEXT.md` for the domain terms and `docs/adr/0001-runstate-owns-state-not-lifecycle.md`
//! for why this module does not own Core lifecycle.

use crate::core::manager::RunningMode;

/// What was last observed about the Service. A fact about the machine, never a request.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ServiceHealth {
    /// Not probed yet.
    #[default]
    Unknown,
    /// Installed, reachable, and speaking a compatible protocol.
    Ready,
    /// No trusted installation evidence on this machine.
    NotInstalled,
    /// Installed but speaking an incompatible protocol; needs reinstall.
    VersionMismatch,
    /// Installed but unusable, with the reason we recorded.
    Unavailable(String),
}

impl ServiceHealth {
    /// The variant name alone, for callers that carry the reason separately.
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

/// A privileged operation this session asked for against the Service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PendingAction {
    Install,
    Uninstall,
    Reinstall,
    ForceReinstall,
}

/// The single consistent answer to "how is the Core running, and what backs it".
///
/// Every question about Core availability is answered by a method here, so that no
/// caller writes its own formula. Construct one via `RunStateStore::state`/`settled`/`probe`.
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
    /// The Service reported itself ready the last time we looked.
    ///
    /// Says nothing about in-flight operations — prefer [`Self::service_usable`] when
    /// deciding whether to rely on the Service right now.
    #[must_use]
    pub const fn service_ready(&self) -> bool {
        matches!(self.health, ServiceHealth::Ready)
    }

    /// The Service can be relied upon right now: ready, and not mid-operation.
    #[must_use]
    pub const fn service_usable(&self) -> bool {
        self.service_ready() && !self.op_in_flight
    }

    /// TUN mode can work right now — either the app is elevated, or the Service backs it.
    #[must_use]
    pub const fn tun_capable(&self) -> bool {
        self.is_admin || self.service_usable()
    }

    /// The Service cannot be used and the user has to choose what to do about it.
    ///
    /// A requested action always needs an answer. Otherwise it is only the states where the
    /// Service is present but unusable: a Service that is simply absent, or a session that has
    /// already settled on Sidecar, needs nothing from anyone.
    #[must_use]
    pub const fn service_needs_attention(&self) -> bool {
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

    /// TUN is switched on but cannot work, and we know that for certain.
    ///
    /// "For certain" is the whole difficulty: an unprobed Service, an operation in flight, or a
    /// decision still sitting in front of the user all mean *not yet known*, and turning TUN
    /// off on a guess would silently undo something the user asked for. This replaces the fixed
    /// startup grace period the frontend used to wait out, which guessed at the same thing.
    #[must_use]
    pub const fn tun_should_be_disabled(&self, tun_enabled: bool) -> bool {
        if !tun_enabled || self.tun_capable() {
            return false;
        }
        !matches!(self.health, ServiceHealth::Unknown) && !self.op_in_flight && !self.service_needs_attention()
    }

    /// The shape sent across the IPC seam.
    ///
    /// Carries the derived answers, not just the raw fields, so that no caller on the other
    /// side reinvents `tun_capable` or the "needs attention" ladder.
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

/// The Run State as the frontend sees it.
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

/// The service-owned part of the Run State, stored behind one lock.
///
/// At most one of `pending` / `sidecar_allowed` is set at a time; the transitions in
/// [`super::RunStateStore`] maintain that, mirroring the single-slot semantics the legacy
/// `ServiceStatus` had.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct StoredService {
    pub health: ServiceHealth,
    pub pending: Option<PendingAction>,
    pub sidecar_allowed: bool,
}

impl StoredService {
    /// Record an observation, clearing any request it answers.
    pub fn observe(&mut self, health: ServiceHealth) {
        self.health = health;
        self.pending = None;
        self.sidecar_allowed = false;
    }

    /// Record a requested privileged operation, preserving the last observation.
    pub const fn request(&mut self, action: PendingAction) {
        self.pending = Some(action);
        self.sidecar_allowed = false;
    }

    /// Record that the user accepted Sidecar for this session.
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
    fn service_usable_requires_no_operation_in_flight() {
        assert!(state(ServiceHealth::Ready, false, false).service_usable());
        assert!(!state(ServiceHealth::Ready, false, true).service_usable());
        assert!(!state(ServiceHealth::NotInstalled, false, false).service_usable());
    }

    #[test]
    fn service_ready_ignores_operations_in_flight() {
        assert!(state(ServiceHealth::Ready, false, true).service_ready());
    }

    #[test]
    fn tun_capable_when_elevated_even_without_service() {
        assert!(state(ServiceHealth::NotInstalled, true, false).tun_capable());
        assert!(state(ServiceHealth::Unavailable("boom".into()), true, true).tun_capable());
        assert!(!state(ServiceHealth::NotInstalled, false, false).tun_capable());
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
    fn a_requested_action_always_needs_an_answer() {
        for action in [
            PendingAction::Install,
            PendingAction::Uninstall,
            PendingAction::Reinstall,
            PendingAction::ForceReinstall,
        ] {
            let mut run_state = state(ServiceHealth::NotInstalled, false, false);
            run_state.pending = Some(action);
            assert!(run_state.service_needs_attention(), "{action:?}");
        }
    }

    #[test]
    fn a_session_that_settled_on_sidecar_needs_nothing() {
        let mut run_state = state(ServiceHealth::VersionMismatch, false, false);
        run_state.sidecar_allowed = true;

        assert!(!run_state.service_needs_attention());
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
    fn tun_is_never_disabled_while_an_operation_is_in_flight() {
        // Mid-install the service is not usable, but that says nothing about what it will be
        // once the operation finishes.
        assert!(!state(ServiceHealth::Ready, false, true).tun_should_be_disabled(true));
        assert!(!state(ServiceHealth::NotInstalled, false, true).tun_should_be_disabled(true));
    }

    #[test]
    fn tun_is_never_disabled_while_the_core_is_not_running() {
        // The startup regression this guards: the service is observed as absent before the
        // startup path has decided whether to install it, and acting on that snapshot both
        // rewrites the user's setting and removes the prompt that would have fixed it.
        // `reconcile_tun_availability` refuses to act at all while the mode is NotRunning;
        // this pins the state that made it dangerous.
        let stopped = state(ServiceHealth::NotInstalled, false, false);

        assert_eq!(stopped.mode, RunningMode::NotRunning);
        assert!(
            stopped.tun_should_be_disabled(true),
            "the predicate alone says yes, which is why the caller must gate on the mode"
        );
    }

    #[test]
    fn tun_is_never_disabled_on_an_unprobed_service() {
        // The old frontend guard waited out a fixed ten seconds to approximate this.
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

    #[test]
    fn observing_clears_a_pending_request() {
        let mut stored = StoredService::default();
        stored.request(PendingAction::Install);
        stored.observe(ServiceHealth::Ready);

        assert_eq!(stored.pending, None);
        assert!(!stored.sidecar_allowed);
        assert_eq!(stored.health, ServiceHealth::Ready);
    }

    #[test]
    fn requesting_and_allowing_sidecar_are_mutually_exclusive() {
        let mut stored = StoredService::default();
        stored.observe(ServiceHealth::NotInstalled);

        stored.request(PendingAction::Install);
        assert!(!stored.sidecar_allowed);

        stored.allow_sidecar();
        assert_eq!(stored.pending, None);
        assert!(stored.sidecar_allowed);

        // The observation survives both requests.
        assert_eq!(stored.health, ServiceHealth::NotInstalled);
    }
}

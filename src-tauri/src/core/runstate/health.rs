//! Run State value types.
//!
//! The central distinction: [`ServiceHealth`] is what we *observed* about the Service,
//! [`PendingAction`] is what this session *asked for*. The legacy `ServiceStatus` enum
//! conflated the two into one slot, which is why narrowing it to `ServiceInstallState`
//! had to be lossy.
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

/// A privileged operation this session asked for against the Service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

//! Run State — the single answer to "how is the Core running, and what backs it".
//!
//! This module owns Service Health, Running Mode, Pending Action and the privileged-operation
//! lock. It deliberately does **not** own starting, stopping or restarting the Core; see
//! `docs/adr/0001-runstate-owns-state-not-lifecycle.md`.
//!
//! Reads come in three flavours that differ only in *freshness* — [`RunStateStore::state`]
//! (cached), [`RunStateStore::settled`] (waits for any in-flight operation) and
//! [`RunStateStore::probe`] (forces live IPC). What the answer *means* is decided by methods
//! on [`RunState`], so no caller writes its own availability formula.

mod env;
mod health;
mod probe;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use anyhow::{Context as _, Result, bail};
use arc_swap::ArcSwap;
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tokio::sync::Notify;

#[cfg(test)]
pub use env::FakeEnv;
pub use env::{RealEnv, RunStateEnv};
pub use health::{PendingAction, RunState, ServiceHealth};
pub use probe::{ServiceVersionCheck, ServiceVersionReply, classify_service_version_reply};

use crate::core::manager::RunningMode;
use health::StoredService;
use probe::{CurrentServiceProbe, classify_service_health, probe_outcome};

/// The process-wide Run State, observing the real machine.
pub static RUN_STATE: Lazy<RunStateStore<RealEnv>> = Lazy::new(|| RunStateStore::new(RealEnv));

/// The service-owned state together with the counter that versions it.
///
/// They share one lock so a reader can never see a change without its version bump.
#[derive(Debug, Default)]
struct VersionedService {
    service: StoredService,
    generation: u64,
}

impl VersionedService {
    const fn bump(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }
}

/// Holds the Run State and the effects needed to keep it current.
#[derive(Debug)]
pub struct RunStateStore<E: RunStateEnv> {
    env: E,
    service: Mutex<VersionedService>,
    mode: ArcSwap<RunningMode>,
    operation_running: AtomicBool,
    operation_done: Notify,
}

impl<E: RunStateEnv> RunStateStore<E> {
    pub fn new(env: E) -> Self {
        Self {
            env,
            service: Mutex::new(VersionedService::default()),
            mode: ArcSwap::new(Arc::new(RunningMode::NotRunning)),
            operation_running: AtomicBool::new(false),
            operation_done: Notify::new(),
        }
    }

    // ─────────────────────────── reads: freshness only ───────────────────────────

    /// The last known Run State, without waiting and without probing.
    ///
    /// May be stale while a privileged operation is in flight — the snapshot says so via
    /// [`RunState::op_in_flight`], and [`RunState::service_usable`] accounts for it.
    pub fn state(&self) -> RunState {
        let service = self.service.lock().service.clone();
        self.snapshot(service)
    }

    /// The Run State once any in-flight privileged operation has finished.
    pub async fn settled(&self) -> RunState {
        loop {
            let notified = self.operation_done.notified();
            if !self.operation_running.load(Ordering::Acquire) {
                let service = self.service.lock().service.clone();
                // Re-check: an operation may have started while we held the lock.
                if !self.operation_running.load(Ordering::Acquire) {
                    return self.snapshot(service);
                }
            }
            notified.await;
        }
    }

    /// Probe the Service now, record what came back, and return the fresh Run State.
    ///
    /// A *transport* failure is not an observation: the Service may simply be restarting, so
    /// the last confirmed health survives and the caller decides whether to retry. Only a
    /// reply we could read and reject updates health.
    pub async fn probe(&self) -> Result<RunState> {
        let reply = self
            .env
            .probe_service_version()
            .await
            .context("service readiness probe failed")?;

        match classify_service_version_reply(&reply) {
            ServiceVersionCheck::Ready => {
                self.observe(ServiceHealth::Ready);
                Ok(self.state())
            }
            ServiceVersionCheck::NeedsReinstall(error) => {
                self.observe(ServiceHealth::VersionMismatch);
                bail!(error)
            }
        }
    }

    /// Work out the Service's health from scratch: platform evidence first, then a live probe.
    ///
    /// Platform evidence that cannot be inspected is *unavailable*, not *absent* — assuming
    /// "not installed" there would offer the user an install that is already there.
    pub async fn detect_service_health(&self) -> ServiceHealth {
        let has_marker = match self.env.trusted_install_evidence() {
            Ok(exists) => exists,
            Err(error) => {
                logging!(
                    warn,
                    Type::Service,
                    "failed to inspect trusted service evidence: {error:#}"
                );
                return ServiceHealth::Unavailable(format!("service detection failed: {error:#}"));
            }
        };

        if !has_marker {
            return classify_service_health(CurrentServiceProbe::Missing, false, "");
        }

        match self.env.probe_service_version().await {
            Ok(reply) => classify_service_health(probe_outcome(&reply), has_marker, ""),
            Err(error) => {
                logging!(warn, Type::Service, "current service IPC is unavailable: {error:#}");
                classify_service_health(
                    CurrentServiceProbe::Unavailable,
                    has_marker,
                    &format!("service detection failed: {error:#}"),
                )
            }
        }
    }

    // ─────────────────────────── writes ───────────────────────────

    /// Record an observation about the Service, clearing any request it answers.
    pub fn observe(&self, health: ServiceHealth) {
        let mut state = self.service.lock();
        if state.service.health == health && state.service.pending.is_none() && !state.service.sidecar_allowed {
            return;
        }
        state.service.observe(health);
        state.bump();
        drop(state);
    }

    /// Record a requested privileged operation without any eligibility check.
    ///
    /// Used when the request came from an explicit user action that has already been
    /// authorised; the guarded session transitions below are for automatic decisions.
    pub fn request_action(&self, action: PendingAction) {
        let mut state = self.service.lock();
        state.service.request(action);
        state.bump();
        drop(state);
    }

    /// Accept Sidecar for the rest of this app session without any eligibility check.
    ///
    /// For builds and paths where Sidecar is the decided outcome rather than a fallback.
    pub fn accept_sidecar(&self) {
        let mut state = self.service.lock();
        if state.service.sidecar_allowed && state.service.pending.is_none() {
            return;
        }
        state.service.allow_sidecar();
        state.bump();
        drop(state);
    }

    /// Accept Sidecar for the rest of this app session.
    ///
    /// Rejected while an operation is in flight, or from a state where the Service is
    /// already usable or is mid-privileged-operation other than an install.
    pub fn allow_sidecar_for_session(&self) -> Result<()> {
        let mut state = self.service.lock();
        if self.operation_running.load(Ordering::Acquire) {
            bail!("service operation already running");
        }
        let permitted = match (state.service.pending, state.service.sidecar_allowed) {
            (Some(PendingAction::Install), _) => true,
            (Some(_), _) | (None, true) => false,
            (None, false) => matches!(
                state.service.health,
                ServiceHealth::NotInstalled | ServiceHealth::VersionMismatch | ServiceHealth::Unavailable(_)
            ),
        };
        if !permitted {
            bail!("sidecar cannot be allowed from service state {:?}", state.service);
        }
        state.service.allow_sidecar();
        state.bump();
        drop(state);
        Ok(())
    }

    /// Require the Service to be installed before the Core starts, when it is simply absent.
    ///
    /// A no-op from any other state, mirroring the rule that an already-requested or
    /// already-usable Service must not be downgraded to "needs installing".
    pub fn require_install_for_session(&self) -> Result<()> {
        let mut state = self.service.lock();
        if self.operation_running.load(Ordering::Acquire) {
            bail!("service operation already running");
        }
        if state.service.pending.is_none()
            && !state.service.sidecar_allowed
            && state.service.health == ServiceHealth::NotInstalled
        {
            state.service.request(PendingAction::Install);
            state.bump();
        }
        drop(state);
        Ok(())
    }

    // ─────────────────────────── running mode ───────────────────────────

    /// The Running Mode, shared so hot callers such as the tray do not allocate.
    pub fn mode_arc(&self) -> Arc<RunningMode> {
        Arc::clone(&self.mode.load())
    }

    /// The Core is now running, and serving, in `mode`.
    pub fn core_started(&self, mode: RunningMode) {
        self.enter_mode(mode);
    }

    /// The Core is no longer running.
    pub fn core_stopped(&self) {
        self.enter_mode(RunningMode::NotRunning);
    }

    /// A start attempt is under way: the Core is not serving yet, whatever the mode says.
    ///
    /// Closes the PAC endpoint without disturbing the Running Mode, so a handover cannot
    /// hand out a PAC script for a proxy port that is between owners.
    pub fn core_starting(&self) {
        self.env.set_pac_available(false);
    }

    /// Move to `mode` and re-derive everything that follows from it.
    ///
    /// PAC availability and the outward mirror are derived here and nowhere else, so they
    /// cannot drift from the Running Mode the way ten hand-paired call sites could.
    ///
    /// PAC closes *before* the mode changes and opens *after*, so whatever a concurrent
    /// reader catches mid-transition is the closed state: being refused a PAC script beats
    /// being handed one that points at a proxy port between owners.
    fn enter_mode(&self, mode: RunningMode) {
        let running = !matches!(mode, RunningMode::NotRunning);
        if !running {
            self.env.set_pac_available(false);
        }
        self.mode.store(Arc::new(mode));
        if running {
            self.env.set_pac_available(true);
        }
        self.env.publish_mode(mode);
    }

    // ─────────────────────────── privileged operations ───────────────────────────

    /// Claim the privileged-operation slot, releasing it when the guard drops.
    ///
    /// Only one privileged operation may be in flight; [`Self::settled`] waits on this.
    pub fn begin_operation(&self) -> Result<OperationGuard<'_, E>> {
        // Taken under the state lock so that a reader cannot observe `operation_running`
        // flipping between its two checks in `settled`.
        let mut state = self.service.lock();
        if self.operation_running.swap(true, Ordering::AcqRel) {
            bail!("service operation already running");
        }
        state.bump();
        drop(state);
        Ok(OperationGuard { store: self })
    }

    /// Whether a privileged operation is in flight right now.
    ///
    /// Production code reads this through [`RunState::op_in_flight`]; this accessor exists for
    /// tests that assert on the slot without taking a snapshot.
    #[cfg(test)]
    pub fn operation_in_flight(&self) -> bool {
        self.operation_running.load(Ordering::Acquire)
    }

    /// Bumped on every state change; lets tests assert that a no-op really was a no-op.
    #[cfg(test)]
    pub fn generation_count(&self) -> u64 {
        self.service.lock().generation
    }

    fn snapshot(&self, service: StoredService) -> RunState {
        RunState {
            health: service.health,
            pending: service.pending,
            sidecar_allowed: service.sidecar_allowed,
            mode: *self.mode.load().as_ref(),
            is_admin: self.env.is_elevated(),
            op_in_flight: self.operation_running.load(Ordering::Acquire),
        }
    }
}

/// Releases the privileged-operation slot and wakes everything waiting in [`RunStateStore::settled`].
#[derive(Debug)]
pub struct OperationGuard<'a, E: RunStateEnv> {
    store: &'a RunStateStore<E>,
}

impl<E: RunStateEnv> Drop for OperationGuard<'_, E> {
    fn drop(&mut self) {
        self.store.operation_running.store(false, Ordering::Release);
        self.store.operation_done.notify_waiters();
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::*;
    use env::FakeEnv;

    fn with_env(env: FakeEnv) -> RunStateStore<FakeEnv> {
        RunStateStore::new(env)
    }

    #[test]
    fn a_fresh_store_knows_nothing() {
        let store = with_env(FakeEnv::new());
        let state = store.state();

        assert_eq!(state.health, ServiceHealth::Unknown);
        assert_eq!(state.pending, None);
        assert!(!state.sidecar_allowed);
        assert_eq!(state.mode, RunningMode::NotRunning);
        assert!(!state.is_admin);
        assert!(!state.op_in_flight);
        assert!(!state.service_usable());
    }

    #[test]
    fn elevation_comes_from_the_environment() {
        assert!(with_env(FakeEnv::new().elevated()).state().is_admin);
        assert!(!with_env(FakeEnv::new()).state().is_admin);
    }

    #[test]
    fn repeated_identical_observations_do_not_bump_the_generation() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let generation = store.generation_count();

        store.observe(ServiceHealth::Ready);

        assert_eq!(store.generation_count(), generation);
    }

    #[test]
    fn observing_clears_a_pending_request() {
        let store = with_env(FakeEnv::new());
        store.request_action(PendingAction::Install);
        store.observe(ServiceHealth::Ready);

        let state = store.state();
        assert_eq!(state.pending, None);
        assert!(state.service_usable());
    }

    #[test]
    fn an_in_flight_operation_makes_a_ready_service_unusable() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        assert!(store.state().service_usable());

        let guard = store.begin_operation().expect("slot should be free");
        assert!(store.state().service_ready());
        assert!(!store.state().service_usable());

        drop(guard);
        assert!(store.state().service_usable());
    }

    #[test]
    fn only_one_privileged_operation_runs_at_a_time() {
        let store = with_env(FakeEnv::new());
        let guard = store.begin_operation().expect("slot should be free");

        assert!(store.begin_operation().is_err());

        drop(guard);
        assert!(store.begin_operation().is_ok());
    }

    #[test]
    fn sidecar_may_be_allowed_when_the_service_is_absent_or_broken() {
        for health in [
            ServiceHealth::NotInstalled,
            ServiceHealth::VersionMismatch,
            ServiceHealth::Unavailable("boom".to_owned()),
        ] {
            let store = with_env(FakeEnv::new());
            store.observe(health.clone());

            store
                .allow_sidecar_for_session()
                .unwrap_or_else(|error| panic!("{health:?} should permit sidecar: {error}"));
            assert!(store.state().sidecar_allowed);
        }
    }

    #[test]
    fn sidecar_may_be_allowed_after_an_install_was_requested() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        store.require_install_for_session().expect("install may be required");
        assert_eq!(store.state().pending, Some(PendingAction::Install));

        store.allow_sidecar_for_session().expect("install may be abandoned");

        let state = store.state();
        assert!(state.sidecar_allowed);
        assert_eq!(state.pending, None);
    }

    #[test]
    fn sidecar_is_refused_when_the_service_is_usable_or_unknown() {
        for health in [ServiceHealth::Unknown, ServiceHealth::Ready] {
            let store = with_env(FakeEnv::new());
            store.observe(health.clone());

            assert!(
                store.allow_sidecar_for_session().is_err(),
                "{health:?} should refuse sidecar"
            );
        }
    }

    #[test]
    fn sidecar_is_refused_during_a_privileged_operation() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        let _guard = store.begin_operation().expect("slot should be free");

        assert!(store.allow_sidecar_for_session().is_err());
    }

    #[test]
    fn requiring_an_install_only_applies_to_an_absent_service() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        store.require_install_for_session().expect("absent service");
        assert_eq!(store.state().pending, Some(PendingAction::Install));

        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        store.require_install_for_session().expect("no-op, not an error");
        assert_eq!(store.state().pending, None);
    }

    #[test]
    fn requiring_an_install_is_refused_during_a_privileged_operation() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        let _guard = store.begin_operation().expect("slot should be free");

        assert!(store.require_install_for_session().is_err());
    }

    #[tokio::test]
    async fn settled_waits_for_an_operation_to_finish() {
        let store = Arc::new(with_env(FakeEnv::new()));
        store.observe(ServiceHealth::NotInstalled);
        let guard = store.begin_operation().expect("slot should be free");

        let waiter = {
            let store = Arc::clone(&store);
            tokio::spawn(async move { store.settled().await })
        };

        // The waiter cannot have finished while the operation is in flight.
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());

        store.observe(ServiceHealth::Ready);
        drop(guard);

        let settled = waiter.await.expect("waiter should not panic");
        assert!(settled.service_usable());
        assert!(!settled.op_in_flight);
    }

    #[tokio::test]
    async fn probing_a_ready_service_records_it() {
        let store = with_env(FakeEnv::new().service_ready());

        let state = store.probe().await.expect("a ready service should probe cleanly");

        assert!(state.service_usable());
        assert_eq!(store.state().health, ServiceHealth::Ready);
    }

    #[tokio::test]
    async fn probing_an_incompatible_service_records_a_version_mismatch() {
        let store = with_env(FakeEnv::new().service_version_mismatch());

        let error = store.probe().await.expect_err("an incompatible service should fail");

        assert!(
            error.to_string().contains("protocol mismatch"),
            "error should explain the mismatch: {error}"
        );
        assert_eq!(store.state().health, ServiceHealth::VersionMismatch);
    }

    #[tokio::test]
    async fn a_transport_failure_does_not_overwrite_confirmed_health() {
        // A Service that is restarting must not be downgraded to "unavailable" on one
        // missed probe — the last confirmed observation stands until we hear otherwise.
        let store = with_env(FakeEnv::new().service_unreachable());
        store.observe(ServiceHealth::Ready);

        let error = store.probe().await.expect_err("an unreachable service should fail");

        assert!(
            error.to_string().contains("service readiness probe failed"),
            "error should name the failed probe: {error}"
        );
        assert_eq!(store.state().health, ServiceHealth::Ready);
    }

    #[tokio::test]
    async fn detection_without_platform_evidence_is_not_installed() {
        let store = with_env(FakeEnv::new().with_evidence(false));

        assert_eq!(store.detect_service_health().await, ServiceHealth::NotInstalled);
    }

    #[tokio::test]
    async fn detection_skips_the_probe_when_there_is_no_evidence() {
        let env = FakeEnv::new().with_evidence(false);
        let store = with_env(env);

        store.detect_service_health().await;

        assert_eq!(store.env.probe_count(), 0, "no evidence means nothing to probe");
    }

    #[tokio::test]
    async fn detection_reports_a_registered_but_unreachable_service_as_unavailable() {
        let store = with_env(FakeEnv::new().service_unreachable());

        let health = store.detect_service_health().await;

        assert!(
            matches!(health, ServiceHealth::Unavailable(_)),
            "registered but silent is unavailable, not absent: {health:?}"
        );
    }

    #[tokio::test]
    async fn detection_treats_an_uninspectable_registry_as_unavailable() {
        let store = with_env(FakeEnv::new().evidence_unavailable());

        let health = store.detect_service_health().await;

        assert!(
            matches!(health, ServiceHealth::Unavailable(_)),
            "an uninspectable registry must not be reported as absent: {health:?}"
        );
    }

    #[tokio::test]
    async fn detection_reports_a_healthy_service_as_ready() {
        let store = with_env(FakeEnv::new().service_ready());

        assert_eq!(store.detect_service_health().await, ServiceHealth::Ready);
    }

    #[test]
    fn running_mode_round_trips() {
        let store = with_env(FakeEnv::new());
        assert_eq!(*store.mode_arc(), RunningMode::NotRunning);

        store.core_started(RunningMode::Service);

        assert_eq!(*store.mode_arc(), RunningMode::Service);
        assert_eq!(store.state().mode, RunningMode::Service);
    }

    #[test]
    fn starting_the_core_opens_pac_and_mirrors_the_mode() {
        for mode in [RunningMode::Service, RunningMode::Sidecar] {
            let store = with_env(FakeEnv::new());

            store.core_started(mode);

            assert_eq!(store.env.pac_available(), Some(true), "{mode} should open PAC");
            assert_eq!(store.env.published_modes(), vec![mode]);
        }
    }

    #[test]
    fn stopping_the_core_closes_pac_and_mirrors_the_mode() {
        let store = with_env(FakeEnv::new());
        store.core_started(RunningMode::Sidecar);

        store.core_stopped();

        assert_eq!(store.state().mode, RunningMode::NotRunning);
        assert_eq!(store.env.pac_available(), Some(false));
        assert_eq!(
            store.env.published_modes(),
            vec![RunningMode::Sidecar, RunningMode::NotRunning]
        );
    }

    #[test]
    fn a_start_attempt_closes_pac_without_disturbing_the_mode() {
        // A handover must not hand out a PAC script for a proxy port between owners, but the
        // Core we are replacing is still the one that is running.
        let store = with_env(FakeEnv::new());
        store.core_started(RunningMode::Sidecar);

        store.core_starting();

        assert_eq!(store.env.pac_available(), Some(false));
        assert_eq!(store.state().mode, RunningMode::Sidecar);
        assert_eq!(
            store.env.published_modes(),
            vec![RunningMode::Sidecar],
            "a start attempt is not a mode change"
        );
    }

    #[test]
    fn pac_availability_can_never_disagree_with_the_running_mode() {
        let store = with_env(FakeEnv::new());

        for mode in [
            RunningMode::Sidecar,
            RunningMode::NotRunning,
            RunningMode::Service,
            RunningMode::NotRunning,
        ] {
            store.core_started(mode);

            let running = !matches!(mode, RunningMode::NotRunning);
            assert_eq!(store.env.pac_available(), Some(running), "mode {mode}");
            assert_eq!(store.state().mode, mode);
        }
    }

    #[test]
    fn service_health_survives_the_core_stopping() {
        // Stopping the Core says nothing about whether the Service is installed.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        store.core_started(RunningMode::Service);

        store.core_stopped();

        assert_eq!(store.state().health, ServiceHealth::Ready);
    }

    #[test]
    fn tun_is_capable_when_elevated_even_with_no_service() {
        let store = with_env(FakeEnv::new().elevated());
        store.observe(ServiceHealth::NotInstalled);

        assert!(store.state().tun_capable());
    }

    #[test]
    fn tun_is_capable_via_a_ready_service_without_elevation() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);

        assert!(store.state().tun_capable());
    }

    #[test]
    fn tun_is_not_capable_mid_operation_without_elevation() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let _guard = store.begin_operation().expect("slot should be free");

        assert!(!store.state().tun_capable());
    }
}

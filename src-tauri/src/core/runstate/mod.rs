//! Run State — the single answer to "how is the Core running, and what backs it".
//!
//! This module owns Service Health, Running Mode, Pending Action and the privileged-operation
//! lock. It deliberately does **not** own starting, stopping or restarting the Core — those
//! stay in `CoreManager`, which reports transitions in and reads snapshots back. Merging the
//! two would leave no point at which the state is consistent, since a snapshot taken
//! mid-restart would describe a transition rather than a state.
//!
//! Reads come in three flavours that differ only in *freshness* — [`RunStateStore::state`]
//! (cached), [`RunStateStore::settled`] (waits for any in-flight operation) and
//! [`RunStateStore::probe`] (forces live IPC). What the answer *means* is decided by methods
//! on [`RunState`], so no caller writes its own availability formula.

mod env;
mod health;
mod owner;
mod probe;

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
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
pub use health::{PendingAction, RunState, RunStateView, ServiceHealth};
pub use owner::{OwnerRecoveryReason, OwnerSample, OwnerStep, OwnerWatch};
pub use probe::{ServiceVersionCheck, ServiceVersionReply, classify_service_version_reply};

use crate::core::manager::RunningMode;
use health::StoredService;
use probe::{CurrentServiceProbe, classify_service_health, probe_outcome};

/// The process-wide Run State, observing the real machine.
pub static RUN_STATE: Lazy<RunStateStore<RealEnv>> = Lazy::new(|| RunStateStore::new(RealEnv));

/// Why a wait for Service readiness ended without a ready Service.
///
/// The two are not interchangeable: an unreachable Service told us nothing, so the caller
/// decides whether silence means unavailable; a rejected one already updated health and must
/// not have that verdict overwritten with a vaguer one.
#[derive(Debug)]
pub enum ReadyWaitError {
    /// No readable reply within the attempts budget.
    Unreachable(anyhow::Error),
    /// The Service answered and we rejected the answer; health records why.
    Rejected(anyhow::Error),
}

impl std::fmt::Display for ReadyWaitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreachable(error) | Self::Rejected(error) => write!(formatter, "{error:#}"),
        }
    }
}

/// The service-owned state together with the counters that version it.
///
/// They share one lock so a reader can never see a change without its version bump.
/// `generation` tracks visible changes; `observation` also tracks assertions that invalidate
/// older health probes without changing visible state.
#[derive(Debug, Default)]
struct VersionedService {
    service: StoredService,
    generation: u64,
    observation: u64,
}

impl VersionedService {
    /// Record a visible change and invalidate older health probes.
    const fn bump(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.observation = self.observation.wrapping_add(1);
    }

    /// Reserve a revision that invalidates older health probes.
    const fn next_observation(&mut self) -> u64 {
        self.observation = self.observation.wrapping_add(1);
        self.observation
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
    ///
    /// The snapshot is the decision, not a separate check before it. Reading the slot twice —
    /// once to decide whether to wait, once to build the snapshot — leaves a window in which an
    /// operation claims it, and the snapshot then *describes* that operation instead of waiting
    /// for it. `prepare_startup` reads this: it would see a requested install as a reason not to
    /// start, where waiting would have told it whether the install worked.
    pub async fn settled(&self) -> RunState {
        loop {
            let notified = self.operation_done.notified();
            tokio::pin!(notified);
            // Register as a waiter *before* reading the state. `notify_waiters` wakes only
            // those already registered and leaves no permit behind, so without this an
            // operation finishing between the read and the await is a wakeup lost for good
            // — and this future would then wait for some unrelated later operation, or
            // forever.
            notified.as_mut().enable();

            let state = self.state();
            if !state.op_in_flight {
                return state;
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
        self.record_reply(&reply)
    }

    /// Probe until the Service answers, giving it `attempts` tries `interval` apart.
    ///
    /// Only an unreachable Service is worth retrying. A reply we could read is the Service's
    /// answer — retrying an incompatible version twenty times would just delay telling the
    /// user to reinstall — so the wait ends on the first readable reply either way.
    pub async fn await_ready(&self, attempts: usize, interval: Duration) -> Result<RunState, ReadyWaitError> {
        let mut last_error = None;
        for attempt in 0..attempts {
            match self.env.probe_service_version().await {
                Ok(reply) => return self.record_reply(&reply).map_err(ReadyWaitError::Rejected),
                Err(error) => last_error = Some(error),
            }
            if attempt + 1 < attempts {
                tokio::time::sleep(interval).await;
            }
        }

        Err(ReadyWaitError::Unreachable(last_error.unwrap_or_else(|| {
            anyhow::anyhow!("service readiness wait was configured with no attempts")
        })))
    }

    /// Record a readable reply as an observation, and report whether it was acceptable.
    fn record_reply(&self, reply: &ServiceVersionReply) -> Result<RunState> {
        match classify_service_version_reply(reply) {
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
        let has_marker = match self.env.trusted_install_evidence().await {
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
                self.log_current_service_ipc_unavailable(&error);
                classify_service_health(
                    CurrentServiceProbe::Unavailable,
                    has_marker,
                    &format!("service detection failed: {error:#}"),
                )
            }
        }
    }

    // ─────────────────────────── writes ───────────────────────────

    /// Probe and record Service health unless a newer observation arrived first.
    ///
    /// Reserving before I/O prevents slower probes from overwriting later observations, including
    /// assertions that leave visible state unchanged. Returns the health that remains recorded.
    pub async fn observe_current_health(&self) -> ServiceHealth {
        let reservation = self.reserve_health_observation();
        let health = self.detect_service_health().await;
        self.commit_reserved_observation(health, reservation)
    }

    fn log_current_service_ipc_unavailable(&self, error: &anyhow::Error) {
        if self.should_warn_on_service_ipc_unavailable() {
            logging!(warn, Type::Service, "current service IPC is unavailable: {error:#}");
        } else {
            logging!(debug, Type::Service, "current service IPC is unavailable: {error:#}");
        }
    }

    fn should_warn_on_service_ipc_unavailable(&self) -> bool {
        matches!(*self.mode_arc(), RunningMode::Service)
    }

    /// Reserve the revision for a health probe.
    fn reserve_health_observation(&self) -> u64 {
        self.service.lock().next_observation()
    }

    /// Commit `health` only if `reservation` is still latest; otherwise return the newer health.
    ///
    /// The comparison and write share one lock. A successful commit reuses its reserved revision.
    fn commit_reserved_observation(&self, health: ServiceHealth, reservation: u64) -> ServiceHealth {
        let mut state = self.service.lock();
        if state.observation != reservation {
            let newer = state.service.health.clone();
            drop(state);
            logging!(
                debug,
                Type::Service,
                "discarding a stale service reading of {health:?}; {newer:?} arrived while it ran"
            );
            return newer;
        }
        if state.service.health == health && state.service.pending.is_none() && !state.service.sidecar_allowed {
            return health;
        }
        state.service.observe(health.clone());
        state.generation = state.generation.wrapping_add(1);
        drop(state);
        self.announce();
        health
    }

    /// Record an observation about the Service, clearing any request it answers.
    pub fn observe(&self, health: ServiceHealth) {
        let mut state = self.service.lock();
        if state.service.health == health && state.service.pending.is_none() && !state.service.sidecar_allowed {
            // Reassertion is invisible but must invalidate an older health probe.
            state.next_observation();
            return;
        }
        state.service.observe(health);
        state.bump();
        drop(state);
        self.announce();
    }

    /// Record an authorised privileged operation and return whether it displaced the session's
    /// Sidecar allowance.
    ///
    /// Reading and clearing the allowance in one transition lets the caller safely restore it if
    /// the operation fails.
    pub fn request_action(&self, action: PendingAction) -> bool {
        let mut state = self.service.lock();
        let displaced = state.service.sidecar_allowed;
        if state.service.pending == Some(action) && !displaced {
            // Reassertion must prevent an older probe from retiring the request.
            state.next_observation();
            return displaced;
        }
        state.service.request(action);
        state.bump();
        drop(state);
        self.announce();
        displaced
    }

    /// Accept Sidecar for the rest of this app session without any eligibility check.
    ///
    /// For builds and paths where Sidecar is the decided outcome rather than a fallback.
    pub fn accept_sidecar(&self) {
        let mut state = self.service.lock();
        if state.service.sidecar_allowed && state.service.pending.is_none() {
            // Reassertion must prevent an older probe from clearing the allowance.
            state.next_observation();
            return;
        }
        state.service.allow_sidecar();
        state.bump();
        drop(state);
        self.announce();
    }

    /// Restore a displaced Sidecar allowance unless one already exists or the Service is ready.
    ///
    /// The check and update are atomic so a restored allowance cannot shadow a newly ready
    /// Service. Returns whether the allowance was restored.
    pub fn restore_sidecar_allowance(&self) -> bool {
        let mut state = self.service.lock();
        if state.service.sidecar_allowed {
            // Reassertion must prevent an older probe from clearing the allowance.
            state.next_observation();
            return false;
        }
        if matches!(state.service.health, ServiceHealth::Ready) {
            // Cached Ready health does not invalidate an in-flight probe.
            return false;
        }
        state.service.allow_sidecar();
        state.bump();
        drop(state);
        self.announce();
        true
    }

    /// Revoke an allowance after Sidecar startup fails without changing Service health.
    ///
    /// Returns whether the allowance was revoked.
    pub fn withdraw_sidecar_allowance(&self) -> bool {
        let mut state = self.service.lock();
        if !state.service.sidecar_allowed {
            return false;
        }
        state.service.sidecar_allowed = false;
        state.bump();
        drop(state);
        self.announce();
        true
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
        self.announce();
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
        } else if state.service.pending == Some(PendingAction::Install) {
            // Reassertion must prevent an older probe from clearing the install request.
            state.next_observation();
        }
        drop(state);
        self.announce();
        Ok(())
    }

    /// Carry out a privileged operation and record what it did to the Service.
    ///
    /// A successful uninstall records an absent Service. Other successes rely on the caller's
    /// readiness check. Failures re-probe the Service so the request is retired and health
    /// reflects the machine's current state.
    pub async fn perform(&self, action: PendingAction) -> Result<()> {
        let outcome = self.env.run_privileged(action);
        match &outcome {
            Ok(()) if matches!(action, PendingAction::Uninstall) => self.observe(ServiceHealth::NotInstalled),
            Ok(()) => {}
            Err(error) => {
                let health = self.observe_current_health().await;
                logging!(
                    warn,
                    Type::Service,
                    "privileged service action {action:?} did not complete ({error:#}); service is {health:?}"
                );
            }
        }
        outcome
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
    ///
    /// Every caller must pair this with [`Self::core_start_settled`]. A start attempt that
    /// never happens — a candidate rejected before anything was stopped — otherwise leaves PAC
    /// closed for a Core that is still serving, and nothing else would ever reopen it: PAC is
    /// re-derived only when the Running Mode changes, and that is exactly what did not happen.
    pub fn core_starting(&self) {
        self.env.set_pac_available(false);
    }

    /// The start attempt is over, however it ended: PAC goes back to following the Running Mode.
    ///
    /// Idempotent and safe on every path, because it re-derives rather than restores. After a
    /// start that succeeded the mode is already running and this confirms PAC open; after one
    /// that was abandoned the mode never moved and this reopens PAC for the Core that kept
    /// serving; after one that failed and stopped the Core the mode says NotRunning and PAC
    /// stays shut.
    pub fn core_start_settled(&self) {
        let running = !matches!(**self.mode.load(), RunningMode::NotRunning);
        self.env.set_pac_available(running);
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
        self.announce();
    }

    // ─────────────────────────── privileged operations ───────────────────────────

    /// Claim the privileged-operation slot, releasing it when the guard drops.
    ///
    /// Only one privileged operation may be in flight; [`Self::settled`] waits on this.
    pub fn begin_operation(&self) -> Result<OperationGuard<'_, E>> {
        let mut state = self.service.lock();
        if self.operation_running.swap(true, Ordering::AcqRel) {
            bail!("service operation already running");
        }
        state.bump();
        drop(state);
        self.announce();
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

    /// The environment this store observes, so tests can assert on the effects it recorded.
    #[cfg(test)]
    pub const fn env(&self) -> &E {
        &self.env
    }

    /// Bumped on every state change; lets tests assert that a no-op really was a no-op.
    #[cfg(test)]
    pub fn generation_count(&self) -> u64 {
        self.service.lock().generation
    }

    /// Tell the outside world the Run State moved.
    ///
    /// Called after every mutation and never while the state lock is held, so a publisher that
    /// reads back the state cannot deadlock against the writer that triggered it.
    fn announce(&self) {
        self.env.publish(&self.state());
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
        self.store.announce();
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

    fn ready_reply() -> ServiceVersionReply {
        ServiceVersionReply {
            code: 0,
            message: "ok".to_owned(),
            protocol: Some(clash_verge_service_ipc::ProtocolInfo::current()),
        }
    }

    #[tokio::test]
    async fn a_reading_nothing_overtook_is_recorded() {
        let store = with_env(FakeEnv::service_ready(FakeEnv::new()));

        let health = store.observe_current_health().await;

        assert_eq!(health, ServiceHealth::Ready);
        assert_eq!(store.state().health, ServiceHealth::Ready);
    }

    #[test]
    fn a_reading_overtaken_by_a_changed_observation_is_discarded() {
        // A slower earlier probe must not overwrite a newer Ready observation.
        let store = with_env(FakeEnv::new());
        let reservation = store.reserve_health_observation();
        store.observe(ServiceHealth::Ready);

        let recorded = store.commit_reserved_observation(ServiceHealth::NotInstalled, reservation);

        assert_eq!(recorded, ServiceHealth::Ready, "the newer observation is reported back");
        assert_eq!(store.state().health, ServiceHealth::Ready, "and it is what stands");
    }

    #[test]
    fn a_reading_overtaken_by_an_unchanged_observation_is_also_discarded() {
        // Even an unchanged "still Ready" observation must invalidate an older probe.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let reservation = store.reserve_health_observation();
        let generation = store.generation_count();

        store.observe(ServiceHealth::Ready);
        assert_eq!(store.generation_count(), generation, "nothing visible changed");

        let recorded = store.commit_reserved_observation(ServiceHealth::NotInstalled, reservation);

        assert_eq!(recorded, ServiceHealth::Ready);
        assert_eq!(store.state().health, ServiceHealth::Ready);
    }

    #[test]
    fn a_reading_overtaken_by_an_already_satisfied_sidecar_restore_is_discarded() {
        // Reasserting an existing allowance must stop an older probe from clearing it.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::VersionMismatch);
        store.accept_sidecar();
        let reservation = store.reserve_health_observation();

        assert!(!store.restore_sidecar_allowance(), "the allowance is already there");

        store.commit_reserved_observation(ServiceHealth::VersionMismatch, reservation);

        assert!(store.state().sidecar_allowed, "the confirmed allowance survives");
        assert!(!store.state().service_needs_attention());
    }

    #[test]
    fn re_requesting_the_same_action_changes_nothing_visible_but_still_orders() {
        // The same request leaves `generation` unchanged but must invalidate an older probe.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        store.require_install_for_session().expect("absent service");
        let generation = store.generation_count();
        let reservation = store.reserve_health_observation();

        assert!(
            !store.request_action(PendingAction::Install),
            "no Sidecar allowance was displaced"
        );
        assert_eq!(store.generation_count(), generation, "nothing visible changed");

        store.commit_reserved_observation(ServiceHealth::NotInstalled, reservation);

        assert_eq!(store.state().pending, Some(PendingAction::Install));
    }

    #[test]
    fn a_reading_overtaken_by_an_already_pending_install_is_discarded() {
        // Requiring an existing install request must stop an older probe from clearing it.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        store.require_install_for_session().expect("absent service");
        let reservation = store.reserve_health_observation();

        store.require_install_for_session().expect("already requested");

        store.commit_reserved_observation(ServiceHealth::NotInstalled, reservation);

        assert_eq!(store.state().pending, Some(PendingAction::Install));
        assert!(store.state().service_needs_attention());
    }

    #[test]
    fn a_later_reading_supersedes_one_that_is_still_running() {
        // The last probe started wins regardless of completion order.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let first = store.reserve_health_observation();
        let second = store.reserve_health_observation();

        assert_eq!(
            store.commit_reserved_observation(ServiceHealth::NotInstalled, first),
            ServiceHealth::Ready,
            "the earlier reading is already superseded"
        );
        assert_eq!(
            store.commit_reserved_observation(ServiceHealth::VersionMismatch, second),
            ServiceHealth::VersionMismatch
        );
        assert_eq!(store.state().health, ServiceHealth::VersionMismatch);
    }

    #[test]
    fn withdrawing_a_sidecar_allowance_says_nothing_about_the_service() {
        // A failed Sidecar startup must not change Service health.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        store.accept_sidecar();

        assert!(store.withdraw_sidecar_allowance());

        assert!(!store.state().sidecar_allowed);
        assert_eq!(store.state().health, ServiceHealth::NotInstalled, "health is untouched");
        assert!(
            !store.state().service_needs_attention(),
            "an absent Service still asks nothing"
        );
    }

    #[test]
    fn withdrawing_an_allowance_that_was_never_granted_changes_nothing() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::NotInstalled);
        let generation = store.generation_count();

        assert!(!store.withdraw_sidecar_allowance());

        assert_eq!(store.generation_count(), generation);
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

    // Multi-threaded on purpose, so operations really do start and finish underneath the reader.
    // This is a guard, not a reproducer: the window it protects against was narrow enough that
    // reverting the fix did not fail this test in six runs. What makes the invariant hold is
    // that `settled` reads the slot once, inside the snapshot it returns; this fails if someone
    // reintroduces a separate check before it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_settled_snapshot_never_describes_an_operation_in_flight() {
        let store = Arc::new(with_env(FakeEnv::new()));
        store.observe(ServiceHealth::Ready);

        for _ in 0..64 {
            let claimer = {
                let store = Arc::clone(&store);
                tokio::spawn(async move {
                    let guard = store.begin_operation();
                    tokio::task::yield_now().await;
                    drop(guard);
                })
            };

            let settled = store.settled().await;
            assert!(!settled.op_in_flight, "a settled snapshot describes a settled state");

            claimer.await.expect("the claimer should not panic");
        }
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
    async fn awaiting_readiness_retries_a_silent_service_then_accepts_its_reply() {
        let store = with_env(FakeEnv::new().replying(vec![Err("ipc path not ready".to_owned()), Ok(ready_reply())]));

        let state = store
            .await_ready(2, Duration::ZERO)
            .await
            .expect("the second attempt should succeed");

        assert!(state.service_usable());
        assert_eq!(store.env.probe_count(), 2, "the first attempt should have been retried");
    }

    #[tokio::test]
    async fn awaiting_readiness_gives_up_after_the_last_attempt() {
        let store = with_env(FakeEnv::new().service_unreachable());
        store.observe(ServiceHealth::Ready);

        let error = store
            .await_ready(3, Duration::ZERO)
            .await
            .expect_err("a silent service should never become ready");

        assert!(matches!(error, ReadyWaitError::Unreachable(_)));
        assert_eq!(store.env.probe_count(), 3, "every attempt should have been used");
        assert_eq!(
            store.state().health,
            ServiceHealth::Ready,
            "silence is the caller's to interpret, not an observation"
        );
    }

    #[tokio::test]
    async fn awaiting_readiness_stops_at_the_first_readable_reply() {
        // Retrying an incompatible version would only delay telling the user to reinstall.
        let store = with_env(FakeEnv::new().service_version_mismatch());

        let error = store
            .await_ready(20, Duration::ZERO)
            .await
            .expect_err("an incompatible service is not ready");

        assert!(matches!(error, ReadyWaitError::Rejected(_)));
        assert_eq!(store.env.probe_count(), 1, "a readable reply ends the wait");
        assert_eq!(store.state().health, ServiceHealth::VersionMismatch);
    }

    #[tokio::test]
    async fn awaiting_readiness_with_no_attempts_is_unreachable_not_ready() {
        let store = with_env(FakeEnv::new().service_ready());

        let error = store
            .await_ready(0, Duration::ZERO)
            .await
            .expect_err("no attempts cannot confirm anything");

        assert!(matches!(error, ReadyWaitError::Unreachable(_)));
        assert_eq!(store.env.probe_count(), 0);
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
    fn unavailable_service_ipc_warns_in_service_mode() {
        let store = with_env(FakeEnv::new());

        store.core_started(RunningMode::Service);

        assert!(store.should_warn_on_service_ipc_unavailable());
    }

    #[test]
    fn unavailable_service_ipc_is_debug_noise_outside_service_mode() {
        let store = with_env(FakeEnv::new());

        assert!(!store.should_warn_on_service_ipc_unavailable());

        store.core_started(RunningMode::Sidecar);

        assert!(!store.should_warn_on_service_ipc_unavailable());
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
    fn an_abandoned_start_attempt_reopens_pac_for_the_core_that_kept_running() {
        // The regression this pins: a proxy-port candidate rejected before anything was
        // stopped. `core_starting` closed PAC, the Running Mode never moved, and so nothing
        // would ever re-derive PAC — the Core kept serving while its PAC endpoint stayed shut.
        for mode in [RunningMode::Service, RunningMode::Sidecar] {
            let store = with_env(FakeEnv::new());
            store.core_started(mode);
            store.core_starting();
            assert_eq!(store.env.pac_available(), Some(false));

            store.core_start_settled();

            assert_eq!(store.env.pac_available(), Some(true), "{mode} kept serving");
            assert_eq!(store.state().mode, mode, "an abandoned start is not a mode change");
        }
    }

    #[test]
    fn a_settled_start_leaves_pac_shut_when_no_core_is_running() {
        let store = with_env(FakeEnv::new());
        store.core_starting();

        store.core_start_settled();

        assert_eq!(store.env.pac_available(), Some(false));
    }

    #[test]
    fn settling_a_start_is_idempotent_and_never_contradicts_the_mode() {
        // Callers pair this with `core_starting` via a guard that runs on every path, so it
        // also runs after a start that already opened PAC itself.
        let store = with_env(FakeEnv::new());
        store.core_starting();
        store.core_started(RunningMode::Service);

        store.core_start_settled();
        store.core_start_settled();

        assert_eq!(store.env.pac_available(), Some(true));
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
    fn every_change_is_published_not_just_mode_changes() {
        // The frontend is pushed to rather than polling, so a health change it would otherwise
        // wait up to a poll interval to notice has to be announced too.
        let store = with_env(FakeEnv::new());

        store.observe(ServiceHealth::NotInstalled);
        store.require_install_for_session().expect("absent service");
        store.core_started(RunningMode::Sidecar);

        let published = store.env.published();
        assert_eq!(published.len(), 3, "each change announces exactly once");
        assert_eq!(published[0].health, ServiceHealth::NotInstalled);
        assert_eq!(published[1].pending, Some(PendingAction::Install));
        assert_eq!(published[2].mode, RunningMode::Sidecar);
    }

    #[test]
    fn a_no_op_change_announces_nothing() {
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let published = store.env.published().len();

        store.observe(ServiceHealth::Ready);

        assert_eq!(store.env.published().len(), published);
    }

    #[test]
    fn starting_and_finishing_an_operation_are_both_published() {
        // op_in_flight is part of the snapshot, so the frontend must learn when it clears.
        let store = with_env(FakeEnv::new());
        store.observe(ServiceHealth::Ready);
        let baseline = store.env.published().len();

        let guard = store.begin_operation().expect("slot should be free");
        drop(guard);

        let published = store.env.published();
        assert_eq!(published.len(), baseline + 2);
        assert!(published[baseline].op_in_flight, "the claim is announced");
        assert!(!published[baseline + 1].op_in_flight, "so is the release");
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

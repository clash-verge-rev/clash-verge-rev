//! The seam between Run State and the machine it observes.
//!
//! Two adapters satisfy it: [`RealEnv`] talks to the Service over IPC and to the platform's
//! service registry, [`FakeEnv`] replays scripted answers. Because the store is generic over
//! this trait rather than reaching for globals, the state machine can be exercised without
//! a running app, an installed Service, or elevation.

use anyhow::Result;

use super::health::{PendingAction, RunState};
use super::probe::ServiceVersionReply;

/// Everything Run State needs from outside itself.
pub trait RunStateEnv: Send + Sync + 'static {
    /// Ask the Service which protocol it speaks. Fails when it cannot be reached at all.
    fn probe_service_version(&self) -> impl Future<Output = Result<ServiceVersionReply>> + Send;

    /// Whether the platform's service registry has a trusted record of an installation.
    ///
    /// Fails when the registry itself could not be inspected, which is different from
    /// "no installation" and is treated as unavailable rather than not-installed.
    fn trusted_install_evidence(&self) -> Result<bool>;

    /// Whether this app process is running elevated.
    fn is_elevated(&self) -> bool;

    /// Open or close the local PAC endpoint.
    ///
    /// Derived from the Running Mode, never set independently: a PAC script that points at a
    /// proxy port nothing is listening on is worse than no PAC at all.
    fn set_pac_available(&self, available: bool);

    /// Publish the Run State to observers outside the store.
    ///
    /// Two of them today: the diagnostic snapshot, which reports the Running Mode, and the
    /// frontend, which gets the whole thing pushed rather than polling for it.
    fn publish(&self, state: &RunState);

    /// Carry out a privileged operation against the Service.
    ///
    /// Blocking and platform-specific — SCM, systemd, launchd, elevation prompts — which is
    /// exactly why it sits behind the seam: the state machine around it can then be exercised
    /// without installing anything.
    fn run_privileged(&self, action: PendingAction) -> Result<()>;
}

/// The production adapter: real IPC, real platform registry, real elevation check.
#[derive(Debug, Default, Clone, Copy)]
pub struct RealEnv;

impl RunStateEnv for RealEnv {
    async fn probe_service_version(&self) -> Result<ServiceVersionReply> {
        let response = clash_verge_service_ipc::get_version().await?;
        Ok(ServiceVersionReply {
            code: response.code,
            message: response.message,
            protocol: response.data,
        })
    }

    fn trusted_install_evidence(&self) -> Result<bool> {
        crate::core::service::trusted_service_evidence()
    }

    fn is_elevated(&self) -> bool {
        // Deliberately non-panicking, unlike `Handle::app_handle()`: Run State is read from
        // startup paths that run before the app handle exists, and "not yet known" must
        // degrade to "not elevated" rather than abort the process.
        crate::APP_HANDLE
            .get()
            .is_some_and(tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin)
    }

    fn set_pac_available(&self, available: bool) {
        crate::utils::server::set_pac_available(available);
    }

    fn publish(&self, state: &RunState) {
        // Non-panicking for the same reason as `is_elevated`: the Core can stop and start
        // before the app handle exists, and a missed notification is better than an abort.
        let Some(app_handle) = crate::APP_HANDLE.get() else {
            return;
        };
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, state.mode.to_string());
        crate::core::handle::Handle::notify_run_state(&state.to_view());

        // Reconciling capability is a reaction to the new state, not part of publishing it, so
        // it is spawned: a transition must not wait on a config write it triggered.
        let state = state.clone();
        crate::process::AsyncHandler::spawn(move || async move {
            crate::feat::reconcile_tun_availability(&state).await;
        });
    }

    fn run_privileged(&self, action: PendingAction) -> Result<()> {
        crate::core::service::run_privileged_service_action(action)
    }
}

#[cfg(test)]
pub use fake::FakeEnv;

#[cfg(test)]
mod fake {
    use anyhow::{Result, anyhow};
    use clash_verge_service_ipc::ProtocolInfo;
    use parking_lot::Mutex;

    use super::{PendingAction, RunState, RunStateEnv, ServiceVersionReply};
    use crate::core::manager::RunningMode;

    /// A scripted stand-in for the machine.
    ///
    /// Defaults to the least capable environment — no Service, no elevation — so a test only
    /// has to say what it needs. Outbound effects are recorded rather than performed.
    #[derive(Debug)]
    pub struct FakeEnv {
        version_replies: Mutex<Vec<Result<ServiceVersionReply, String>>>,
        evidence: Result<bool, String>,
        elevated: bool,
        probe_count: Mutex<usize>,
        pac_available: Mutex<Option<bool>>,
        published: Mutex<Vec<RunState>>,
        privileged_outcome: Mutex<Result<(), String>>,
        privileged_actions: Mutex<Vec<PendingAction>>,
    }

    impl Default for FakeEnv {
        fn default() -> Self {
            Self {
                version_replies: Mutex::new(Vec::new()),
                evidence: Ok(false),
                elevated: false,
                probe_count: Mutex::new(0),
                pac_available: Mutex::new(None),
                published: Mutex::new(Vec::new()),
                privileged_outcome: Mutex::new(Ok(())),
                privileged_actions: Mutex::new(Vec::new()),
            }
        }
    }

    impl FakeEnv {
        #[must_use]
        pub fn new() -> Self {
            Self::default()
        }

        /// An installed, reachable, protocol-compatible Service.
        #[must_use]
        pub fn service_ready(self) -> Self {
            self.with_evidence(true).always_replying(Ok(ServiceVersionReply {
                code: 0,
                message: "ok".to_owned(),
                protocol: Some(ProtocolInfo::current()),
            }))
        }

        /// An installed Service that answers with an incompatible protocol.
        #[must_use]
        pub fn service_version_mismatch(self) -> Self {
            self.with_evidence(true).always_replying(Ok(ServiceVersionReply {
                code: 0,
                message: "ok".to_owned(),
                protocol: None,
            }))
        }

        /// Registered with the platform but not answering.
        #[must_use]
        pub fn service_unreachable(self) -> Self {
            self.with_evidence(true)
                .always_replying(Err("ipc transport refused".to_owned()))
        }

        /// The platform registry itself could not be inspected.
        #[must_use]
        pub fn evidence_unavailable(mut self) -> Self {
            self.evidence = Err("registry probe failed".to_owned());
            self
        }

        #[must_use]
        pub const fn elevated(mut self) -> Self {
            self.elevated = true;
            self
        }

        #[must_use]
        pub fn with_evidence(mut self, exists: bool) -> Self {
            self.evidence = Ok(exists);
            self
        }

        /// Queue replies consumed one per probe; the last one repeats once exhausted.
        #[must_use]
        pub fn replying(self, replies: Vec<Result<ServiceVersionReply, String>>) -> Self {
            *self.version_replies.lock() = replies;
            self
        }

        #[must_use]
        pub fn always_replying(self, reply: Result<ServiceVersionReply, String>) -> Self {
            self.replying(vec![reply])
        }

        /// How many times the Service was probed — asserts that retries actually retried.
        #[must_use]
        pub fn probe_count(&self) -> usize {
            *self.probe_count.lock()
        }

        /// The last PAC availability the store asked for, or `None` if it never asked.
        #[must_use]
        pub fn pac_available(&self) -> Option<bool> {
            *self.pac_available.lock()
        }

        /// Every Running Mode published outward, in order.
        #[must_use]
        pub fn published_modes(&self) -> Vec<RunningMode> {
            self.published.lock().iter().map(|state| state.mode).collect()
        }

        /// Every Run State published outward, in order.
        #[must_use]
        pub fn published(&self) -> Vec<RunState> {
            self.published.lock().clone()
        }

        /// Make every privileged operation fail with `reason`.
        #[must_use]
        pub fn privileged_operations_fail(self, reason: &str) -> Self {
            *self.privileged_outcome.lock() = Err(reason.to_owned());
            self
        }

        /// Every privileged operation actually attempted, in order.
        #[must_use]
        pub fn privileged_actions(&self) -> Vec<PendingAction> {
            self.privileged_actions.lock().clone()
        }
    }

    impl RunStateEnv for FakeEnv {
        async fn probe_service_version(&self) -> Result<ServiceVersionReply> {
            *self.probe_count.lock() += 1;
            let mut replies = self.version_replies.lock();
            let reply = if replies.len() > 1 {
                replies.remove(0)
            } else {
                replies
                    .first()
                    .cloned()
                    .unwrap_or_else(|| Err("no service configured".to_owned()))
            };
            reply.map_err(|error| anyhow!(error))
        }

        fn trusted_install_evidence(&self) -> Result<bool> {
            self.evidence.clone().map_err(|error| anyhow!(error))
        }

        fn is_elevated(&self) -> bool {
            self.elevated
        }

        fn set_pac_available(&self, available: bool) {
            *self.pac_available.lock() = Some(available);
        }

        fn publish(&self, state: &RunState) {
            self.published.lock().push(state.clone());
        }

        fn run_privileged(&self, action: PendingAction) -> Result<()> {
            self.privileged_actions.lock().push(action);
            self.privileged_outcome.lock().clone().map_err(|error| anyhow!(error))
        }
    }
}

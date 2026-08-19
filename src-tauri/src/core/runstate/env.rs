//! Adapters between Run State and the real or scripted machine it observes.

use anyhow::{Context as _, Result};

use super::health::{PendingAction, RunState};
use super::probe::ServiceVersionReply;

/// Everything Run State needs from outside itself.
pub trait RunStateEnv: Send + Sync + 'static {
    fn probe_service_version(&self) -> impl Future<Output = Result<ServiceVersionReply>> + Send;

    /// Returns an error when installation evidence cannot be inspected, not when it is absent.
    fn trusted_install_evidence(&self) -> impl Future<Output = Result<bool>> + Send;

    fn is_elevated(&self) -> bool;

    /// Keeps the PAC endpoint derived from Running Mode.
    fn set_pac_available(&self, available: bool);

    fn publish(&self, state: &RunState);

    fn run_privileged(&self, action: PendingAction) -> Result<()>;
}

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

    async fn trusted_install_evidence(&self) -> Result<bool> {
        tokio::task::spawn_blocking(crate::core::service::trusted_service_evidence)
            .await
            .context("service registration probe did not finish")?
    }

    fn is_elevated(&self) -> bool {
        // Startup may read Run State before the app handle exists; fail closed instead of panicking.
        crate::APP_HANDLE
            .get()
            .is_some_and(tauri_plugin_clash_verge_sysinfo::is_current_app_handle_admin)
    }

    fn set_pac_available(&self, available: bool) {
        crate::utils::server::set_pac_available(available);
    }

    fn publish(&self, state: &RunState) {
        // Reconciliation must run before the app handle exists and must not block this transition.
        crate::process::AsyncHandler::spawn(|| async {
            crate::feat::reconcile_tun_availability().await;
        });

        let Some(app_handle) = crate::APP_HANDLE.get() else {
            return;
        };
        tauri_plugin_clash_verge_sysinfo::set_app_core_mode(app_handle, state.mode.to_string());
        crate::core::handle::Handle::notify_run_state(&state.to_view());
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

    /// A fail-closed scripted machine that records outbound effects.
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

        #[must_use]
        pub fn service_ready(self) -> Self {
            self.with_evidence(true).always_replying(Ok(ServiceVersionReply {
                code: 0,
                message: "ok".to_owned(),
                protocol: Some(ProtocolInfo::current()),
            }))
        }

        #[must_use]
        pub fn service_version_mismatch(self) -> Self {
            self.with_evidence(true).always_replying(Ok(ServiceVersionReply {
                code: 0,
                message: "ok".to_owned(),
                protocol: None,
            }))
        }

        #[must_use]
        pub fn service_unreachable(self) -> Self {
            self.with_evidence(true)
                .always_replying(Err("ipc transport refused".to_owned()))
        }

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

        #[must_use]
        pub fn probe_count(&self) -> usize {
            *self.probe_count.lock()
        }

        #[must_use]
        pub fn pac_available(&self) -> Option<bool> {
            *self.pac_available.lock()
        }

        #[must_use]
        pub fn published_modes(&self) -> Vec<RunningMode> {
            self.published.lock().iter().map(|state| state.mode).collect()
        }

        #[must_use]
        pub fn published(&self) -> Vec<RunState> {
            self.published.lock().clone()
        }

        #[must_use]
        pub fn privileged_operations_fail(self, reason: &str) -> Self {
            *self.privileged_outcome.lock() = Err(reason.to_owned());
            self
        }

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

        async fn trusted_install_evidence(&self) -> Result<bool> {
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

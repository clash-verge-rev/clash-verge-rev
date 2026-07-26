mod config;
mod lifecycle;
mod state;

use anyhow::Result;
use arc_swap::{ArcSwap, ArcSwapOption};
use clash_verge_logger::AsyncLogger;
use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};
use tauri_plugin_shell::process::CommandChild;

use crate::core::runstate::{RUN_STATE, RealEnv, RunStateStore};
use crate::singleton;
#[cfg(target_os = "windows")]
use std::os::windows::io::OwnedHandle;

pub(crate) static CLASH_LOGGER: Lazy<Arc<AsyncLogger>> = Lazy::new(|| Arc::new(AsyncLogger::new()));

const CORE_READINESS_ACTIVE_BIT: u64 = 1;
const CORE_READINESS_GENERATION_STEP: u64 = 1 << 1;

const fn next_active_core_readiness_state(state: u64) -> u64 {
    (state.wrapping_add(CORE_READINESS_GENERATION_STEP) & !CORE_READINESS_ACTIVE_BIT) | CORE_READINESS_ACTIVE_BIT
}

const fn inactive_core_readiness_state(state: u64) -> u64 {
    state.wrapping_add(CORE_READINESS_GENERATION_STEP) & !CORE_READINESS_ACTIVE_BIT
}

const fn active_core_readiness_generation(state: u64) -> Option<u64> {
    if state & CORE_READINESS_ACTIVE_BIT != 0 {
        Some(state)
    } else {
        None
    }
}

fn claim_core_readiness_generation(state: &AtomicU64, captured_generation: u64) -> bool {
    state
        .compare_exchange(
            captured_generation,
            inactive_core_readiness_state(captured_generation),
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq, Eq)]
pub enum RunningMode {
    Service,
    Sidecar,
    NotRunning,
}

impl fmt::Display for RunningMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Service => write!(f, "Service"),
            Self::Sidecar => write!(f, "Sidecar"),
            Self::NotRunning => write!(f, "NotRunning"),
        }
    }
}

#[derive(Debug)]
pub struct CoreManager {
    /// The Run State this manager reports transitions to.
    ///
    /// A reference rather than the global directly, so a test can supervise a Core without
    /// racing every other test for one process-wide Running Mode.
    run_state: &'static RunStateStore<RealEnv>,
    state: ArcSwap<State>,
    last_update: ArcSwapOption<Instant>,
    #[cfg(target_os = "windows")]
    job_handle: ArcSwapOption<OwnedHandle>,
    config_update_in_progress: AtomicBool,
    core_readiness_state: AtomicU64,
    // 串行化 start/stop/restart 和 sidecar→service 交接。
    // 锁序固定为 config_update_in_progress → lifecycle_lock。
    pub(crate) lifecycle_lock: tokio::sync::Mutex<()>,
    // sidecar→service 交接 watcher 单实例标志。
    #[cfg(target_os = "windows")]
    handoff_watcher_running: AtomicBool,
}

/// Process-level state owned by `CoreManager`.
///
/// Running Mode deliberately does *not* live here — it belongs to `core::runstate`, which
/// keeps it consistent with Service Health and derives PAC availability from it.
#[derive(Debug, Default)]
struct State {
    child_sidecar: ArcSwapOption<CommandChild>,
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            run_state: &RUN_STATE,
            state: ArcSwap::new(Arc::new(State::default())),
            last_update: ArcSwapOption::new(None),
            #[cfg(target_os = "windows")]
            job_handle: ArcSwapOption::new(None),
            config_update_in_progress: AtomicBool::new(false),
            core_readiness_state: AtomicU64::new(0),
            lifecycle_lock: tokio::sync::Mutex::new(()),
            #[cfg(target_os = "windows")]
            handoff_watcher_running: AtomicBool::new(false),
        }
    }
}

impl CoreManager {
    fn new() -> Self {
        Self::default()
    }

    /// A manager with its own Run State, for tests that must not disturb the process-wide one.
    #[cfg(test)]
    fn isolated() -> Self {
        Self {
            run_state: Box::leak(Box::new(RunStateStore::new(RealEnv))),
            ..Self::default()
        }
    }

    pub fn get_running_mode(&self) -> Arc<RunningMode> {
        self.run_state.mode_arc()
    }

    pub fn take_child_sidecar(&self) -> Option<CommandChild> {
        self.state
            .load()
            .child_sidecar
            .swap(None)
            .and_then(|arc| Arc::try_unwrap(arc).ok())
    }

    pub fn get_running_sidecar_pid(&self) -> Option<u32> {
        self.state.load().child_sidecar.load_full().map(|child| child.pid())
    }

    pub fn get_last_update(&self) -> Option<Arc<Instant>> {
        self.last_update.load_full()
    }

    /// The Core is now running in `mode`.
    ///
    /// Run State derives PAC availability and the outward mode mirror from this; callers must
    /// not set those alongside.
    pub fn core_started(&self, mode: RunningMode) {
        self.run_state.core_started(mode);
    }

    /// The Core is no longer running, for any reason.
    ///
    /// Core readiness is invalidated here rather than inside Run State because readiness
    /// belongs to the process this manager supervises.
    pub fn core_stopped(&self) {
        self.invalidate_core_readiness();
        self.run_state.core_stopped();
    }

    /// A start attempt is under way and the Core is not serving yet.
    pub fn core_starting(&self) {
        self.run_state.core_starting();
    }

    pub fn set_running_child_sidecar(&self, child: CommandChild) {
        let state = self.state.load();
        state.child_sidecar.store(Some(Arc::new(child)));
    }

    fn mark_core_ready(&self) -> u64 {
        let mut current = self.core_readiness_state.load(Ordering::Acquire);
        loop {
            let next = next_active_core_readiness_state(current);
            match self
                .core_readiness_state
                .compare_exchange(current, next, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => return next,
                Err(changed) => current = changed,
            }
        }
    }

    fn current_core_readiness_generation(&self) -> Option<u64> {
        active_core_readiness_generation(self.core_readiness_state.load(Ordering::Acquire))
    }

    pub(crate) fn invalidate_core_readiness(&self) {
        let _ = self
            .core_readiness_state
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                active_core_readiness_generation(current).map(inactive_core_readiness_state)
            });
    }

    fn invalidate_core_readiness_if(&self, captured_generation: u64) -> bool {
        claim_core_readiness_generation(&self.core_readiness_state, captured_generation)
    }

    pub fn set_last_update(&self, time: Instant) {
        self.last_update.store(Some(Arc::new(time)));
    }

    /// Replaces the Windows Job Object handle owned by the core manager
    ///
    /// Passing `None` drops the current handle, which closes the Job Object
    /// and terminates its assigned processes due to `KILL_ON_JOB_CLOSE`.
    ///
    /// This method is currently only used on Windows.
    #[cfg(target_os = "windows")]
    fn set_job_handle(&self, handle: Option<OwnedHandle>) {
        self.job_handle.store(handle.map(Arc::new));
    }

    pub(crate) fn try_start_config_update(&self) -> bool {
        !self.config_update_in_progress.swap(true, Ordering::AcqRel)
    }

    pub(crate) fn finish_config_update(&self) {
        self.config_update_in_progress.store(false, Ordering::Release);
    }

    pub async fn init(&self) -> Result<bool> {
        const MAX_PORT_FALLBACK_RETRIES: usize = 3;

        if let Some(reason) = crate::config::Config::startup_core_block_reason() {
            anyhow::bail!("core startup blocked after mixed proxy port fallback failure: {reason}");
        }

        let mut retries = 0;
        loop {
            match self.start_core().await {
                Ok(()) => {
                    crate::config::Config::notify_startup_mixed_port_fallback();
                    return Ok(!matches!(*self.get_running_mode(), RunningMode::NotRunning));
                }
                Err(start_error) if retries < MAX_PORT_FALLBACK_RETRIES => {
                    if !matches!(*self.get_running_mode(), RunningMode::NotRunning) {
                        crate::config::Config::notify_startup_mixed_port_fallback();
                        return Err(start_error);
                    }
                    match crate::config::Config::retry_startup_mixed_port_fallback().await {
                        Ok(true) => {
                            retries += 1;
                            logging!(
                                warn,
                                Type::Core,
                                "Retrying core startup after mixed proxy port fallback ({}/{})",
                                retries,
                                MAX_PORT_FALLBACK_RETRIES
                            );
                        }
                        Ok(false) => {
                            crate::config::Config::notify_startup_mixed_port_fallback();
                            return Err(start_error);
                        }
                        Err(fallback_error) => {
                            crate::config::Config::block_startup_core(&fallback_error);
                            return Err(anyhow::anyhow!(
                                "core startup failed: {start_error:#}; mixed proxy port fallback failed: \
                                 {fallback_error:#}"
                            ));
                        }
                    }
                }
                Err(error) => {
                    crate::config::Config::notify_startup_mixed_port_fallback();
                    return Err(error);
                }
            }
        }
    }
}

singleton!(CoreManager, CORE_MANAGER);

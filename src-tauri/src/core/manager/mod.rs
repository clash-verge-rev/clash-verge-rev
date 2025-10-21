mod config;
mod lifecycle;
mod process;
mod state;

use anyhow::Result;
use parking_lot::Mutex;
use std::{fmt, sync::Arc, time::Instant};
use tokio::sync::Semaphore;

use crate::process::CommandChildGuard;
use crate::singleton_lazy;

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
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
    state: Arc<Mutex<State>>,
    update_semaphore: Arc<Semaphore>,
    last_update: Arc<Mutex<Option<Instant>>>,
}

#[derive(Debug)]
struct State {
    running_mode: RunningMode,
    child_sidecar: Option<CommandChildGuard>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            running_mode: RunningMode::NotRunning,
            child_sidecar: None,
        }
    }
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            update_semaphore: Arc::new(Semaphore::new(1)),
            last_update: Arc::new(Mutex::new(None)),
        }
    }
}

impl CoreManager {
    pub fn get_running_mode(&self) -> RunningMode {
        self.state.lock().running_mode
    }

    pub fn set_running_mode(&self, mode: RunningMode) {
        self.state.lock().running_mode = mode;
    }

    pub async fn init(&self) -> Result<()> {
        self.cleanup_orphaned_processes().await?;
        self.start_core().await?;
        Ok(())
    }
}

singleton_lazy!(CoreManager, CORE_MANAGER, CoreManager::default);

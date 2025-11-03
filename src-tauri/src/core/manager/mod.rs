mod config;
mod lifecycle;
mod state;

use anyhow::Result;
use parking_lot::Mutex;
use std::{fmt, sync::Arc, time::Instant};

use crate::process::CommandChildGuard;
use crate::singleton_lazy;

#[derive(Debug, serde::Serialize, PartialEq, Eq)]
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
    last_update: Arc<Mutex<Option<Instant>>>,
}

#[derive(Debug)]
struct State {
    running_mode: Arc<RunningMode>,
    child_sidecar: Option<CommandChildGuard>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            running_mode: Arc::new(RunningMode::NotRunning),
            child_sidecar: None,
        }
    }
}

impl Default for CoreManager {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            last_update: Arc::new(Mutex::new(None)),
        }
    }
}

impl CoreManager {
    pub fn get_running_mode(&self) -> Arc<RunningMode> {
        Arc::clone(&self.state.lock().running_mode)
    }

    pub fn set_running_mode(&self, mode: RunningMode) {
        self.state.lock().running_mode = Arc::new(mode);
    }

    pub fn set_running_child_sidecar(&self, child: CommandChildGuard) {
        self.state.lock().child_sidecar = Some(child);
    }

    pub async fn init(&self) -> Result<()> {
        self.start_core().await?;
        Ok(())
    }
}

singleton_lazy!(CoreManager, CORE_MANAGER, CoreManager::default);

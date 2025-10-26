use once_cell::sync::OnceCell;
use smartstring::alias::String;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) static SWITCH_MUTEX: OnceCell<Mutex<()>> = OnceCell::new();
pub(super) static CURRENT_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub(super) static CURRENT_SWITCHING_PROFILE: AtomicBool = AtomicBool::new(false);
pub(super) static SWITCH_TASK_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) const SWITCH_JOB_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const SWITCH_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub(super) struct SwitchRequest {
    pub(super) task_id: u64,
    pub(super) profile_id: String,
    pub(super) notify: bool,
}

pub(super) struct SwitchScope;

impl SwitchScope {
    pub(super) fn begin() -> Self {
        CURRENT_SWITCHING_PROFILE.store(true, Ordering::SeqCst);
        Self
    }
}

impl Drop for SwitchScope {
    fn drop(&mut self) {
        CURRENT_SWITCHING_PROFILE.store(false, Ordering::SeqCst);
    }
}

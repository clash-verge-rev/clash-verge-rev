use once_cell::sync::OnceCell;
use smartstring::alias::String as SmartString;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) const SWITCH_JOB_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const SWITCH_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

static SWITCH_MANAGER: OnceCell<SwitchManager> = OnceCell::new();

pub(super) fn manager() -> &'static SwitchManager {
    SWITCH_MANAGER.get_or_init(SwitchManager::default)
}

#[derive(Debug)]
pub(super) struct SwitchManager {
    core_mutex: Mutex<()>,
    request_sequence: AtomicU64,
    switching: AtomicBool,
    task_sequence: AtomicU64,
}

impl Default for SwitchManager {
    fn default() -> Self {
        Self {
            core_mutex: Mutex::new(()),
            request_sequence: AtomicU64::new(0),
            switching: AtomicBool::new(false),
            task_sequence: AtomicU64::new(0),
        }
    }
}

impl SwitchManager {
    pub(super) fn core_mutex(&self) -> &Mutex<()> {
        &self.core_mutex
    }

    pub(super) fn next_task_id(&self) -> u64 {
        self.task_sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(super) fn next_request_sequence(&self) -> u64 {
        self.request_sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(super) fn latest_request_sequence(&self) -> u64 {
        self.request_sequence.load(Ordering::SeqCst)
    }

    pub(super) fn begin_switch(&'static self) -> SwitchScope<'static> {
        self.switching.store(true, Ordering::SeqCst);
        SwitchScope { manager: self }
    }

    pub(super) fn is_switching(&self) -> bool {
        self.switching.load(Ordering::SeqCst)
    }
}

pub(super) struct SwitchScope<'a> {
    manager: &'a SwitchManager,
}

impl Drop for SwitchScope<'_> {
    fn drop(&mut self) {
        self.manager.switching.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone)]
pub(super) struct SwitchCancellation(Arc<AtomicBool>);

impl SwitchCancellation {
    pub(super) fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub(super) fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    pub(super) fn same_token(&self, other: &SwitchCancellation) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

#[derive(Debug, Clone)]
pub(super) struct SwitchRequest {
    task_id: u64,
    profile_id: SmartString,
    notify: bool,
    cancel_token: SwitchCancellation,
}

impl SwitchRequest {
    pub(super) fn new(task_id: u64, profile_id: SmartString, notify: bool) -> Self {
        Self {
            task_id,
            profile_id,
            notify,
            cancel_token: SwitchCancellation::new(),
        }
    }

    pub(super) fn task_id(&self) -> u64 {
        self.task_id
    }

    pub(super) fn profile_id(&self) -> &SmartString {
        &self.profile_id
    }

    pub(super) fn notify(&self) -> bool {
        self.notify
    }

    pub(super) fn merge_notify(&mut self, notify: bool) {
        if notify {
            self.notify = true;
        }
    }

    pub(super) fn cancel_token(&self) -> &SwitchCancellation {
        &self.cancel_token
    }
}

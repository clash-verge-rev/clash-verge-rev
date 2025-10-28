use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::Serialize;
use smartstring::alias::String as SmartString;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    status: RwLock<ProfileSwitchStatus>,
}

impl Default for SwitchManager {
    fn default() -> Self {
        Self {
            core_mutex: Mutex::new(()),
            request_sequence: AtomicU64::new(0),
            switching: AtomicBool::new(false),
            task_sequence: AtomicU64::new(0),
            status: RwLock::new(ProfileSwitchStatus::default()),
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

    pub(super) fn set_status(&self, status: ProfileSwitchStatus) {
        *self.status.write() = status;
    }

    pub(super) fn status_snapshot(&self) -> ProfileSwitchStatus {
        self.status.read().clone()
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
    heartbeat: SwitchHeartbeat,
}

impl SwitchRequest {
    pub(super) fn new(task_id: u64, profile_id: SmartString, notify: bool) -> Self {
        Self {
            task_id,
            profile_id,
            notify,
            cancel_token: SwitchCancellation::new(),
            heartbeat: SwitchHeartbeat::new(),
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

    pub(super) fn heartbeat(&self) -> &SwitchHeartbeat {
        &self.heartbeat
    }
}

#[derive(Debug, Clone)]
pub(super) struct SwitchHeartbeat {
    last_tick_millis: Arc<AtomicU64>,
    stage_code: Arc<AtomicU32>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSwitchStatus {
    pub is_switching: bool,
    pub active: Option<SwitchTaskStatus>,
    pub queue: Vec<SwitchTaskStatus>,
    pub cleanup_profiles: Vec<String>,
    pub last_result: Option<SwitchResultStatus>,
    pub last_updated: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchTaskStatus {
    pub task_id: u64,
    pub profile_id: String,
    pub notify: bool,
    pub stage: Option<u32>,
    pub queued: bool,
}

impl SwitchTaskStatus {
    pub(super) fn from_request(request: &SwitchRequest, queued: bool) -> Self {
        Self {
            task_id: request.task_id(),
            profile_id: request.profile_id().to_string(),
            notify: request.notify(),
            stage: if queued {
                None
            } else {
                Some(request.heartbeat().stage_code())
            },
            queued,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResultStatus {
    pub task_id: u64,
    pub profile_id: String,
    pub success: bool,
    pub finished_at: u64,
    pub error_stage: Option<String>,
    pub error_detail: Option<String>,
}

impl SwitchResultStatus {
    pub(super) fn success(task_id: u64, profile_id: &SmartString) -> Self {
        Self {
            task_id,
            profile_id: profile_id.to_string(),
            success: true,
            finished_at: now_millis(),
            error_stage: None,
            error_detail: None,
        }
    }

    pub(super) fn failed(
        task_id: u64,
        profile_id: &SmartString,
        stage: Option<String>,
        detail: Option<String>,
    ) -> Self {
        Self {
            task_id,
            profile_id: profile_id.to_string(),
            success: false,
            finished_at: now_millis(),
            error_stage: stage,
            error_detail: detail,
        }
    }
}

pub(super) fn current_millis() -> u64 {
    now_millis()
}

impl SwitchHeartbeat {
    fn now_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_millis() as u64
    }

    pub(super) fn new() -> Self {
        let heartbeat = Self {
            last_tick_millis: Arc::new(AtomicU64::new(Self::now_millis())),
            stage_code: Arc::new(AtomicU32::new(0)),
        };
        heartbeat.touch();
        heartbeat
    }

    pub(super) fn touch(&self) {
        self.last_tick_millis
            .store(Self::now_millis(), Ordering::SeqCst);
    }

    pub(super) fn elapsed(&self) -> Duration {
        let last = self.last_tick_millis.load(Ordering::SeqCst);
        let now = Self::now_millis();
        Duration::from_millis(now.saturating_sub(last))
    }

    pub(super) fn set_stage(&self, stage: u32) {
        self.stage_code.store(stage, Ordering::SeqCst);
        self.touch();
    }

    pub(super) fn stage_code(&self) -> u32 {
        self.stage_code.load(Ordering::SeqCst)
    }
}

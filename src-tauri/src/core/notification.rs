use crate::{
    constants::{retry, timing},
    logging,
    utils::logging::Type,
};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Instant,
};
use tauri::{Emitter, WebviewWindow};

#[derive(Debug, Clone)]
pub enum FrontendEvent {
    RefreshClash,
    RefreshVerge,
    RefreshProxy,
    ProxiesUpdated {
        payload: serde_json::Value,
    },
    NoticeMessage {
        status: String,
        message: String,
    },
    ProfileChanged {
        current_profile_id: String,
    },
    ProfileSwitchFinished {
        profile_id: String,
        success: bool,
        notify: bool,
        task_id: u64,
    },
    TimerUpdated {
        profile_index: String,
    },
    ProfileUpdateStarted {
        uid: String,
    },
    ProfileUpdateCompleted {
        uid: String,
    },
    RustPanic {
        message: String,
        location: String,
    },
}

#[derive(Debug, Default)]
struct EventStats {
    total_sent: AtomicU64,
    total_errors: AtomicU64,
    last_error_time: RwLock<Option<Instant>>,
}

const SKIP_PROFILE_SWITCH_FINISHED_STATIC: bool = false;
const SKIP_PROFILE_SWITCH_FINISHED_ENV: &str = "CVR_SKIP_PROFILE_SWITCH_FINISHED";
const SKIP_NOTICE_MESSAGE_STATIC: bool = true;
const SKIP_NOTICE_MESSAGE_ENV: &str = "CVR_SKIP_NOTICE_MESSAGE";
const SKIP_REFRESH_PROXY_STATIC: bool = true;
const SKIP_REFRESH_PROXY_ENV: &str = "CVR_SKIP_REFRESH_PROXY";

#[derive(Debug, Clone)]
pub struct ErrorMessage {
    pub status: String,
    pub message: String,
}

#[derive(Debug)]
pub struct NotificationSystem {
    sender: Option<mpsc::Sender<FrontendEvent>>,
    #[allow(clippy::type_complexity)]
    worker_handle: Option<thread::JoinHandle<()>>,
    pub(super) is_running: bool,
    stats: EventStats,
    emergency_mode: RwLock<bool>,
}

impl Default for NotificationSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationSystem {
    pub fn new() -> Self {
        Self {
            sender: None,
            worker_handle: None,
            is_running: false,
            stats: EventStats::default(),
            emergency_mode: RwLock::new(false),
        }
    }

    pub fn start(&mut self) {
        if self.is_running {
            return;
        }

        let (tx, rx) = mpsc::channel();
        self.sender = Some(tx);
        self.is_running = true;

        let result = thread::Builder::new()
            .name("frontend-notifier".into())
            .spawn(move || Self::worker_loop(rx));

        match result {
            Ok(handle) => self.worker_handle = Some(handle),
            Err(e) => logging!(
                error,
                Type::System,
                "Failed to start notification worker: {}",
                e
            ),
        }
    }

    fn worker_loop(rx: mpsc::Receiver<FrontendEvent>) {
        use super::handle::Handle;

        let handle = Handle::global();
        logging!(info, Type::Frontend, "Notification worker started");

        while !handle.is_exiting() {
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(event) => {
                    logging!(
                        info,
                        Type::Frontend,
                        "Worker received event: {}",
                        Self::describe_event(&event)
                    );
                    Self::process_event(handle, event)
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }

        logging!(info, Type::Frontend, "Notification worker exiting");
    }

    fn process_event(handle: &super::handle::Handle, event: FrontendEvent) {
        let system_guard = handle.notification_system.read();
        let Some(system) = system_guard.as_ref() else {
            return;
        };

        if system.should_skip_event(&event) {
            return;
        }

        if let Some(window) = super::handle::Handle::get_window() {
            logging!(
                info,
                Type::Frontend,
                "Processing event for window: {}",
                Self::describe_event(&event)
            );
            let start = std::time::Instant::now();
            system.emit_to_window(&window, event);
            let elapsed = start.elapsed();
            logging!(info, Type::Frontend, "Event processed in {:?}", elapsed);
            thread::sleep(timing::EVENT_EMIT_DELAY);
        }
    }

    fn should_skip_event(&self, event: &FrontendEvent) -> bool {
        let is_emergency = *self.emergency_mode.read();
        if (SKIP_PROFILE_SWITCH_FINISHED_STATIC || Self::skip_profile_switch_finished_env())
            && matches!(event, FrontendEvent::ProfileSwitchFinished { .. })
        {
            logging!(
                warn,
                Type::Frontend,
                "Skipping ProfileSwitchFinished event (static={}, env={})",
                SKIP_PROFILE_SWITCH_FINISHED_STATIC,
                env::var(SKIP_PROFILE_SWITCH_FINISHED_ENV).unwrap_or_else(|_| "unset".into())
            );
            return true;
        }

        if (SKIP_NOTICE_MESSAGE_STATIC || Self::skip_notice_env())
            && matches!(event, FrontendEvent::NoticeMessage { .. })
        {
            logging!(
                warn,
                Type::Frontend,
                "Skipping NoticeMessage event (static={}, env={})",
                SKIP_NOTICE_MESSAGE_STATIC,
                env::var(SKIP_NOTICE_MESSAGE_ENV).unwrap_or_else(|_| "unset".into())
            );
            return true;
        }

        if (SKIP_REFRESH_PROXY_STATIC || Self::skip_refresh_proxy_env())
            && matches!(event, FrontendEvent::RefreshProxy)
        {
            logging!(
                warn,
                Type::Frontend,
                "Skipping RefreshProxy event (static={}, env={})",
                SKIP_REFRESH_PROXY_STATIC,
                env::var(SKIP_REFRESH_PROXY_ENV).unwrap_or_else(|_| "unset".into())
            );
            return true;
        }

        matches!(
            (is_emergency, event),
            (true, FrontendEvent::NoticeMessage { status, .. }) if status == "info"
        )
    }

    fn skip_profile_switch_finished_env() -> bool {
        match env::var(SKIP_PROFILE_SWITCH_FINISHED_ENV) {
            Ok(value) => value != "0",
            Err(_) => false,
        }
    }

    fn skip_notice_env() -> bool {
        match env::var(SKIP_NOTICE_MESSAGE_ENV) {
            Ok(value) => value != "0",
            Err(_) => false,
        }
    }

    fn skip_refresh_proxy_env() -> bool {
        match env::var(SKIP_REFRESH_PROXY_ENV) {
            Ok(value) => value != "0",
            Err(_) => false,
        }
    }

    fn emit_to_window(&self, window: &WebviewWindow, event: FrontendEvent) {
        let (event_name, payload) = self.serialize_event(event);

        let Ok(payload) = payload else {
            self.stats.total_errors.fetch_add(1, Ordering::Relaxed);
            return;
        };

        let emit_result =
            if event_name == "profile-switch-finished" || event_name == "verge://notice-message" {
                let app_handle = super::handle::Handle::app_handle();
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    app_handle
                        .emit_to("main", event_name, payload.clone())
                        .map_err(|e| e)
                }))
            } else {
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    window.emit(event_name, payload.clone()).map_err(|e| e)
                }))
            };

        match emit_result {
            Ok(Ok(())) => {
                self.stats.total_sent.fetch_add(1, Ordering::Relaxed);
                logging!(
                    info,
                    Type::Frontend,
                    "Event emitted: {} payload={}",
                    event_name,
                    payload
                );
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Frontend, "Event emit failed: {}", e);
                self.handle_emit_error();
            }
            Err(payload) => {
                logging!(
                    error,
                    Type::Frontend,
                    "Event emit panicked: {} ({})",
                    event_name,
                    super::handle::describe_panic(payload.as_ref())
                );
                self.handle_emit_error();
            }
        }
    }

    fn describe_event(event: &FrontendEvent) -> String {
        match event {
            FrontendEvent::RefreshClash => String::from("RefreshClash"),
            FrontendEvent::RefreshVerge => String::from("RefreshVerge"),
            FrontendEvent::RefreshProxy => String::from("RefreshProxy"),
            FrontendEvent::ProxiesUpdated { .. } => String::from("ProxiesUpdated"),
            FrontendEvent::NoticeMessage { status, .. } => {
                format!("NoticeMessage({})", status).into()
            }
            FrontendEvent::ProfileChanged { current_profile_id } => {
                format!("ProfileChanged({})", current_profile_id).into()
            }
            FrontendEvent::ProfileSwitchFinished {
                profile_id,
                task_id,
                ..
            } => format!(
                "ProfileSwitchFinished(profile={}, task={})",
                profile_id, task_id
            )
            .into(),
            FrontendEvent::TimerUpdated { profile_index } => {
                format!("TimerUpdated({})", profile_index).into()
            }
            FrontendEvent::ProfileUpdateStarted { uid } => {
                format!("ProfileUpdateStarted({})", uid).into()
            }
            FrontendEvent::ProfileUpdateCompleted { uid } => {
                format!("ProfileUpdateCompleted({})", uid).into()
            }
            FrontendEvent::RustPanic { message, .. } => format!("RustPanic({})", message).into(),
        }
    }

    fn serialize_event(
        &self,
        event: FrontendEvent,
    ) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
        use serde_json::json;

        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::NoticeMessage { status, message } => (
                "verge://notice-message",
                serde_json::to_value((status, message)),
            ),
            FrontendEvent::RefreshProxy => ("verge://refresh-proxy-config", Ok(json!("yes"))),
            FrontendEvent::ProxiesUpdated { payload } => ("proxies-updated", Ok(payload)),
            FrontendEvent::ProfileChanged { current_profile_id } => {
                ("profile-changed", Ok(json!(current_profile_id)))
            }
            FrontendEvent::ProfileSwitchFinished {
                profile_id,
                success,
                notify,
                task_id,
            } => (
                "profile-switch-finished",
                Ok(json!({
                    "profileId": profile_id,
                    "success": success,
                    "notify": notify,
                    "taskId": task_id
                })),
            ),
            FrontendEvent::TimerUpdated { profile_index } => {
                ("verge://timer-updated", Ok(json!(profile_index)))
            }
            FrontendEvent::ProfileUpdateStarted { uid } => {
                ("profile-update-started", Ok(json!({ "uid": uid })))
            }
            FrontendEvent::ProfileUpdateCompleted { uid } => {
                ("profile-update-completed", Ok(json!({ "uid": uid })))
            }
            FrontendEvent::RustPanic { message, location } => (
                "rust-panic",
                Ok(json!({ "message": message, "location": location })),
            ),
        }
    }

    fn handle_emit_error(&self) {
        self.stats.total_errors.fetch_add(1, Ordering::Relaxed);
        *self.stats.last_error_time.write() = Some(Instant::now());

        let errors = self.stats.total_errors.load(Ordering::Relaxed);
        if errors > retry::EVENT_EMIT_THRESHOLD && !*self.emergency_mode.read() {
            logging!(
                warn,
                Type::Frontend,
                "Entering emergency mode after {} errors",
                errors
            );
            *self.emergency_mode.write() = true;
        }
    }

    pub fn send_event(&self, event: FrontendEvent) -> bool {
        if self.should_skip_event(&event) {
            return false;
        }

        if let Some(sender) = &self.sender {
            if sender.send(event).is_err() {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to send event to worker thread"
                );
                self.handle_emit_error();
                return false;
            }
            return true;
        }

        false
    }

    pub fn shutdown(&mut self) {
        self.is_running = false;

        if let Some(sender) = self.sender.take() {
            drop(sender);
        }

        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
    }
}

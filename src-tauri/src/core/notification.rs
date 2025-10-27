use crate::{constants::retry, logging, utils::logging::Type};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Instant,
};
use tauri::{Emitter, async_runtime};
use tokio::time::{Duration, sleep};

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
    total_errors: AtomicU64,
    last_error_time: RwLock<Option<Instant>>,
}

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

        while !handle.is_exiting() {
            match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                Ok(event) => Self::process_event(handle, event),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }

    fn process_event(handle: &super::handle::Handle, event: FrontendEvent) {
        let system_guard = handle.notification_system.read();
        let Some(system) = system_guard.as_ref() else {
            return;
        };

        if system.should_skip_event(&event) {
            return;
        }

        let event_label = Self::describe_event(&event);
        logging!(
            info,
            Type::Frontend,
            "Queueing event for async emit: {}",
            event_label
        );

        let (event_name, payload_result) = system.serialize_event(event);
        let payload = match payload_result {
            Ok(value) => value,
            Err(err) => {
                logging!(
                    warn,
                    Type::Frontend,
                    "Failed to serialize event {}: {}",
                    event_name,
                    err
                );
                return;
            }
        };

        logging!(
            info,
            Type::Frontend,
            "Async emit scheduled after delay: {}",
            event_name
        );
        async_runtime::spawn(async move {
            let start = Instant::now();
            sleep(Duration::from_millis(50)).await;
            logging!(
                info,
                Type::Frontend,
                "Async emit invoking emit_to: {} (delay {:?})",
                event_name,
                start.elapsed()
            );
            let emit_start = Instant::now();
            if let Err(err) = Self::emit_via_app(event_name, payload).await {
                logging!(
                    warn,
                    Type::Frontend,
                    "Async emit failed: {} after {:?}",
                    err,
                    emit_start.elapsed()
                );
            } else {
                logging!(
                    info,
                    Type::Frontend,
                    "Async emit completed: {} (emit duration {:?})",
                    event_name,
                    emit_start.elapsed()
                );
            }
        });
    }

    fn should_skip_event(&self, event: &FrontendEvent) -> bool {
        let is_emergency = *self.emergency_mode.read();
        matches!(
            (is_emergency, event),
            (true, FrontendEvent::NoticeMessage { status, .. }) if status == "info"
        )
    }

    async fn emit_via_app(
        event_name: &'static str,
        payload: serde_json::Value,
    ) -> Result<(), String> {
        let app_handle = super::handle::Handle::app_handle().clone();
        logging!(
            info,
            Type::Frontend,
            "emit_via_app entering spawn_blocking: {}",
            event_name
        );
        async_runtime::spawn_blocking(move || {
            logging!(
                info,
                Type::Frontend,
                "emit_via_app calling emit_to synchronously: {}",
                event_name
            );
            app_handle
                .emit_to("main", event_name, payload)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| String::from(format!("Join error: {}", e)))?
        .map_err(String::from)
    }

    fn describe_event(event: &FrontendEvent) -> String {
        match event {
            FrontendEvent::RefreshClash => "RefreshClash".into(),
            FrontendEvent::RefreshVerge => "RefreshVerge".into(),
            FrontendEvent::RefreshProxy => "RefreshProxy".into(),
            FrontendEvent::ProxiesUpdated { .. } => "ProxiesUpdated".into(),
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

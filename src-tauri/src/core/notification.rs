use crate::{
    constants::{retry, timing},
    logging,
    utils::logging::Type,
};
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
use tauri::{Emitter, WebviewWindow};

#[derive(Debug, Clone)]
pub enum FrontendEvent {
    RefreshClash,
    RefreshVerge,
    NoticeMessage { status: String, message: String },
    ProfileChanged { current_profile_id: String },
    TimerUpdated { profile_index: String },
    ProfileUpdateStarted { uid: String },
    ProfileUpdateCompleted { uid: String },
}

#[derive(Debug, Default)]
struct EventStats {
    total_sent: AtomicU64,
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
            match rx.recv() {
                Ok(event) => Self::process_event(handle, event),
                Err(e) => {
                    logging!(
                        error,
                        Type::System,
                        "receive event error, stop notification worker: {}",
                        e
                    );
                    break;
                }
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

        if let Some(window) = super::handle::Handle::get_window() {
            system.emit_to_window(&window, event);
            thread::sleep(timing::EVENT_EMIT_DELAY);
        }
    }

    fn should_skip_event(&self, event: &FrontendEvent) -> bool {
        let is_emergency = *self.emergency_mode.read();
        matches!(
            (is_emergency, event),
            (true, FrontendEvent::NoticeMessage { status, .. }) if status == "info"
        )
    }

    fn emit_to_window(&self, window: &WebviewWindow, event: FrontendEvent) {
        let (event_name, payload) = self.serialize_event(event);

        let Ok(payload) = payload else {
            self.stats.total_errors.fetch_add(1, Ordering::Relaxed);
            return;
        };

        match window.emit(event_name, payload) {
            Ok(_) => {
                self.stats.total_sent.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => {
                logging!(warn, Type::Frontend, "Event emit failed: {}", e);
                self.handle_emit_error();
            }
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
            FrontendEvent::ProfileChanged { current_profile_id } => {
                ("profile-changed", Ok(json!(current_profile_id)))
            }
            FrontendEvent::TimerUpdated { profile_index } => {
                ("verge://timer-updated", Ok(json!(profile_index)))
            }
            FrontendEvent::ProfileUpdateStarted { uid } => {
                ("profile-update-started", Ok(json!({ "uid": uid })))
            }
            FrontendEvent::ProfileUpdateCompleted { uid } => {
                ("profile-update-completed", Ok(json!({ "uid": uid })))
            }
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
            sender.send(event).is_ok()
        } else {
            false
        }
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

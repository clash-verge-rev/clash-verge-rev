use super::handle::Handle;
use crate::constants::{retry, timing};
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use smartstring::alias::String;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Instant,
};
use tauri::{Emitter as _, WebviewWindow};

// TODO 重构或优化，避免 Clone 过多
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
    emergency_mode: AtomicBool,
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
            emergency_mode: AtomicBool::new(false),
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
            Err(e) => logging!(error, Type::System, "Failed to start notification worker: {}", e),
        }
    }

    fn worker_loop(rx: mpsc::Receiver<FrontendEvent>) {
        let handle = Handle::global();
        loop {
            if handle.is_exiting() {
                break;
            }
            match rx.recv() {
                Ok(event) => Self::process_event(handle, event),
                Err(e) => {
                    logging!(error, Type::System, "Notification System will exit, recv error: {}", e);
                    break;
                }
            }
        }
    }

    fn process_event(handle: &super::handle::Handle, event: FrontendEvent) {
        let binding = handle.notification_system.read();
        let system = match binding.as_ref() {
            Some(s) => s,
            None => return,
        };

        if system.should_skip_event(&event) {
            return;
        }

        if let Some(window) = super::handle::Handle::get_window() {
            system.emit_to_window(&window, event);
            drop(binding);
            thread::sleep(timing::EVENT_EMIT_DELAY);
        }
    }

    fn should_skip_event(&self, event: &FrontendEvent) -> bool {
        let is_emergency = self.emergency_mode.load(Ordering::Acquire);
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

    fn serialize_event(&self, event: FrontendEvent) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
        use serde_json::json;

        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::NoticeMessage { status, message } => {
                ("verge://notice-message", serde_json::to_value((status, message)))
            }
            FrontendEvent::ProfileChanged { current_profile_id } => ("profile-changed", Ok(json!(current_profile_id))),
            FrontendEvent::TimerUpdated { profile_index } => ("verge://timer-updated", Ok(json!(profile_index))),
            FrontendEvent::ProfileUpdateStarted { uid } => ("profile-update-started", Ok(json!({ "uid": uid }))),
            FrontendEvent::ProfileUpdateCompleted { uid } => ("profile-update-completed", Ok(json!({ "uid": uid }))),
        }
    }

    fn handle_emit_error(&self) {
        self.stats.total_errors.fetch_add(1, Ordering::Relaxed);
        *self.stats.last_error_time.write() = Some(Instant::now());

        let errors = self.stats.total_errors.load(Ordering::Relaxed);
        if errors > retry::EVENT_EMIT_THRESHOLD && !self.emergency_mode.load(Ordering::Acquire) {
            logging!(warn, Type::Frontend, "Entering emergency mode after {} errors", errors);
            self.emergency_mode.store(true, Ordering::Release);
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

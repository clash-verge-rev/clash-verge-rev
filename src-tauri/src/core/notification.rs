use super::handle::Handle;
use crate::{constants::timing, utils::window_manager::WindowManager};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::{sync::mpsc, thread};
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

#[derive(Debug)]
pub struct NotificationSystem {
    sender: Option<mpsc::Sender<FrontendEvent>>,
    #[allow(clippy::type_complexity)]
    worker_handle: Option<thread::JoinHandle<()>>,
}

impl Default for NotificationSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationSystem {
    pub const fn new() -> Self {
        Self {
            sender: None,
            worker_handle: None,
        }
    }

    pub const fn is_running(&self) -> bool {
        self.sender.is_some() && self.worker_handle.is_some()
    }

    pub fn start(&mut self) {
        if self.is_running() {
            return;
        }

        let (tx, rx) = mpsc::channel();
        self.sender = Some(tx);

        //? Do we have to create a new thread for this?
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

        if let Some(window) = WindowManager::get_main_window() {
            system.emit_to_window(&window, event);
            drop(binding);
            thread::sleep(timing::EVENT_EMIT_DELAY);
        }
    }

    fn emit_to_window(&self, window: &WebviewWindow, event: FrontendEvent) {
        let (event_name, payload) = self.serialize_event(event);

        let Ok(payload) = payload else {
            return;
        };

        if let Err(e) = window.emit(event_name, payload) {
            logging!(warn, Type::Frontend, "Event emit failed: {}", e);
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

    pub fn send_event(&self, event: FrontendEvent) -> bool {
        if !self.is_running() {
            return false;
        }

        if let Some(sender) = &self.sender {
            sender.send(event).is_ok()
        } else {
            false
        }
    }

    pub fn shutdown(&mut self) {
        if let Some(sender) = self.sender.take() {
            drop(sender);
        }

        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }
    }
}

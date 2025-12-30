use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use super::handle::Handle;
use clash_verge_logging::{Type, logging};
use serde_json::json;
use smartstring::alias::String;
use tauri::{
    Emitter as _, WebviewWindow,
    async_runtime::{JoinHandle, Receiver, Sender, channel},
};

// TODO 重构或优化，避免 Clone 过多
#[derive(Debug, Clone)]
pub(super) enum FrontendEvent {
    RefreshClash,
    RefreshVerge,
    NoticeMessage { status: String, message: String },
    ProfileChanged { current_profile_id: String },
    TimerUpdated { profile_index: String },
    ProfileUpdateStarted { uid: String },
    ProfileUpdateCompleted { uid: String },
}

#[derive(Debug, Default)]
pub struct NotificationSystem {
    sender: Arc<Option<Sender<FrontendEvent>>>,
    worker_task: Arc<Option<JoinHandle<()>>>,
    pub(super) is_running: AtomicBool,
}

impl NotificationSystem {
    pub fn start(&mut self) {
        if self
            .is_running
            .compare_exchange(false, true, Ordering::Release, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        let (tx, rx) = channel(32);
        if let Some(s) = Arc::get_mut(&mut self.sender) {
            *s = Some(tx);
        }
        let task = tauri::async_runtime::spawn(async move {
            Self::worker_loop(rx).await;
        });
        if let Some(t) = Arc::get_mut(&mut self.worker_task) {
            *t = Some(task);
        }
    }

    pub fn shutdown(&mut self) {
        if self
            .is_running
            .compare_exchange(true, false, Ordering::Release, Ordering::Relaxed)
            .is_err()
        {
            return;
        }

        self.sender = Arc::new(None);

        let value = Arc::get_mut(&mut self.worker_task).and_then(|t| t.take());
        if let Some(task) = value {
            task.abort();
        }
    }

    pub fn send_event(&self, event: FrontendEvent) -> bool {
        if let Some(sender) = &*self.sender {
            sender.try_send(event).is_ok()
        } else {
            false
        }
    }
}

impl NotificationSystem {
    async fn worker_loop(mut rx: Receiver<FrontendEvent>) {
        let handle = Handle::global();
        while let Some(event) = rx.recv().await {
            if handle.is_exiting() {
                break;
            }
            Self::process_event_sync(handle, event);
        }
    }

    fn process_event_sync(handle: &super::handle::Handle, event: FrontendEvent) {
        if let Some(window) = super::handle::Handle::get_window() {
            handle.notification_system.lock().emit_to_window(&window, event);
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
}

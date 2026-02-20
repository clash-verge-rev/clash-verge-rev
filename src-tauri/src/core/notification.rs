use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use serde_json::json;
use smartstring::alias::String;

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
pub struct NotificationSystem {}

impl NotificationSystem {
    fn emit_to_window(window: &WebviewWindow, event: FrontendEvent) {
        let (event_name, Ok(payload)) = Self::serialize_event(event) else {
            return;
        };

        if let Err(e) = window.emit(event_name, payload) {
            logging!(warn, Type::Frontend, "Event emit failed: {}", e);
        }
    }

    fn serialize_event(event: FrontendEvent) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
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

    pub(crate) fn send_event(event: FrontendEvent) {
        if let Some(window) = WindowManager::get_main_window() {
            Self::emit_to_window(&window, event);
        }
    }
}

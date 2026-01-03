use clash_verge_logging::{Type, logging};
use serde_json::json;
use smartstring::alias::String;
use tauri::{Emitter as _, WebviewWindow};

use crate::process::AsyncHandler;

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

pub(super) struct NotificationSystem;

impl NotificationSystem {
    pub(super) fn send_event(window: Option<WebviewWindow>, event: FrontendEvent) {
        if let Some(window) = window {
            AsyncHandler::spawn_blocking(move || {
                Self::emit_to_window(window, event);
            });
        }
    }

    fn emit_to_window(window: WebviewWindow, event: FrontendEvent) {
        let (event_name, payload) = Self::serialize_event(event);
        let Ok(payload) = payload else {
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
}

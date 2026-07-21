use clash_verge_logging::{Type, logging};
use serde_json::json;
use smartstring::alias::String;

use tauri::{AppHandle, Emitter as _, Manager as _, WebviewWindow};

#[derive(Debug)]
pub enum FrontendEvent<'a> {
    RefreshClash,
    RefreshVerge,
    RefreshProfiles,
    NoticeMessage { status: &'a str, message: String },
    ProfileChanged { current_profile_id: &'a String },
    TimerUpdated { profile_index: &'a String },
    ProfileUpdateStarted { uid: &'a String },
    ProfileUpdateCompleted { uid: &'a String },
}

#[derive(Debug)]
pub struct NotificationSystem {}

impl NotificationSystem {
    fn emit_to_window(window: &WebviewWindow, event_name: &'static str, payload: serde_json::Value) {
        if let Err(e) = window.emit(event_name, payload) {
            logging!(warn, Type::Frontend, "Event emit failed: {}", e);
        }
    }

    fn serialize_event(event: FrontendEvent) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::RefreshProfiles => ("verge://refresh-profiles", Ok(json!("yes"))),
            FrontendEvent::NoticeMessage { status, message } => {
                ("verge://notice-message", serde_json::to_value((status, message)))
            }
            FrontendEvent::ProfileChanged { current_profile_id } => ("profile-changed", Ok(json!(current_profile_id))),
            FrontendEvent::TimerUpdated { profile_index } => ("verge://timer-updated", Ok(json!(profile_index))),
            FrontendEvent::ProfileUpdateStarted { uid } => ("profile-update-started", Ok(json!({ "uid": uid }))),
            FrontendEvent::ProfileUpdateCompleted { uid } => ("profile-update-completed", Ok(json!({ "uid": uid }))),
        }
    }

    pub(crate) fn send_event(app_handle: AppHandle, event: FrontendEvent) {
        let (event_name, Ok(payload)) = Self::serialize_event(event) else {
            return;
        };
        let dispatch_handle = app_handle.clone();
        // Emitting from a runtime worker can deadlock on macOS when WebKit's protocol handler
        // waits for Tauri's webview lock while emit waits synchronously for the main thread.
        if let Err(err) = app_handle.run_on_main_thread(move || {
            if let Some(window) = dispatch_handle.get_webview_window("main") {
                Self::emit_to_window(&window, event_name, payload);
            }
        }) {
            logging!(warn, Type::Frontend, "Failed to dispatch event on main thread: {err}");
        }
    }
}

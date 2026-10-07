use super::NoticeStatus;
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
#[cfg(test)]
use serde_json::json;
use smartstring::alias::String;
use std::sync::Arc;
use std::sync::LazyLock;
use std::{collections::HashMap, future::Future};
use tauri::{AppHandle, Emitter as _, Manager as _, WebviewWindow};

#[derive(Debug, Clone)]
pub enum FrontendEvent<'a> {
    RefreshClash,
    RefreshVerge,
    RefreshProfiles,
    RefreshProxyConfig,
    NoticeMessage {
        status: NoticeStatus,
        message: Arc<str>,
    },
    ProfileChanged {
        current_profile_id: &'a String,
    },
    TimerUpdated {
        profile_index: &'a String,
    },
    ProfileUpdateStarted {
        uid: &'a String,
    },
    ProfileUpdateCompleted {
        uid: &'a String,
    },
    RunStateChanged {
        state: crate::core::runstate::RunStateView,
    },
    PendingFailuresChanged,
    #[cfg(target_os = "linux")]
    ThemeChanged {
        theme: tauri::Theme,
    },
}

/// Operation associated with a pending failure.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FailedOperation {
    SystemProxyEnable,
    SystemProxyDisable,
    SystemProxyRestore,
    SystemProxyGuard,
}

impl FailedOperation {
    /// User requests outrank incidental restores under the same code.
    const fn outranks(self, other: Self) -> bool {
        matches!(self, Self::SystemProxyEnable | Self::SystemProxyDisable) && matches!(other, Self::SystemProxyRestore)
    }

    /// Whether a successful apply of `asked` resolves this operation's failure.
    const fn retired_by_success_of(self, asked: Self) -> bool {
        match (self, asked) {
            // Only replacing or stopping the guard resolves its failure.
            (Self::SystemProxyGuard, _) | (_, Self::SystemProxyGuard) => false,
            // The user asked and got an answer, so nothing earlier is still owed to them.
            (_, Self::SystemProxyEnable | Self::SystemProxyDisable) => true,
            // An incidental restore says nothing about a request they may not have seen fail.
            (Self::SystemProxyRestore, Self::SystemProxyRestore) => true,
            (_, Self::SystemProxyRestore) => false,
        }
    }
}

/// Latest unresolved failure for one stable code.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingFailure {
    /// Stable code used as the table key.
    #[specta(type = std::string::String)]
    pub code: String,
    /// Full diagnostic context chain.
    #[specta(type = std::string::String)]
    pub detail: String,
    pub operation: FailedOperation,
    /// Monotonic identity for repeated failures under the same code.
    pub sequence: u64,
}

/// Non-destructive pending state, indexed by stable code.
#[derive(Debug, Default)]
struct FailureTable {
    entries: Mutex<FailureEntries>,
}

#[derive(Debug, Default)]
struct FailureEntries {
    map: HashMap<String, PendingFailure>,
    sequence: u64,
}

impl FailureTable {
    fn record(&self, operation: FailedOperation, code: &str, detail: String) {
        // Sequence assignment and replacement must share one ordering lock.
        let mut entries = self.entries.lock();
        entries.sequence = entries.sequence.wrapping_add(1);
        // Preserve an unanswered request over a later restore.
        let operation = entries
            .map
            .get(code)
            .filter(|existing| existing.operation.outranks(operation))
            .map_or(operation, |existing| existing.operation);
        let failure = PendingFailure {
            code: code.into(),
            detail,
            operation,
            sequence: entries.sequence,
        };
        entries.map.insert(code.into(), failure);
    }

    fn snapshot(&self) -> Vec<PendingFailure> {
        let mut failures: Vec<PendingFailure> = self.entries.lock().map.values().cloned().collect();
        failures.sort_by_key(|failure| failure.sequence);
        failures
    }

    /// Return whether a guard failure was retired.
    fn retire_guard(&self) -> bool {
        let mut entries = self.entries.lock();
        let before = entries.map.len();
        entries
            .map
            .retain(|_, failure| failure.operation != FailedOperation::SystemProxyGuard);
        before != entries.map.len()
    }

    /// Return whether any proxy failure was retired.
    fn retire_system_proxy(&self, asked: FailedOperation) -> bool {
        let mut entries = self.entries.lock();
        let before = entries.map.len();
        entries
            .map
            .retain(|_, failure| !failure.operation.retired_by_success_of(asked));
        before != entries.map.len()
    }
}

#[cfg(test)]
mod failure_table_tests {
    use super::{FailedOperation, FailureTable};

    #[tokio::test]
    async fn a_declared_intent_reaches_the_place_the_write_fails() {
        let asked = super::asking_for(FailedOperation::SystemProxyEnable, async {
            tokio::task::yield_now().await;
            super::what_was_asked()
        })
        .await;

        assert_eq!(asked, FailedOperation::SystemProxyEnable);
        assert_eq!(super::what_was_asked(), FailedOperation::SystemProxyRestore);
    }

    #[test]
    fn an_incidental_failure_does_not_take_over_a_request_the_user_is_still_owed() {
        let table = FailureTable::default();
        table.record(
            FailedOperation::SystemProxyEnable,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "asked for it on".into(),
        );
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "and a restart hit it too".into(),
        );

        let entries = table.snapshot();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].operation, FailedOperation::SystemProxyEnable);
        assert_eq!(entries[0].detail, "and a restart hit it too");

        assert!(!table.retire_system_proxy(FailedOperation::SystemProxyRestore));
        assert!(table.retire_system_proxy(FailedOperation::SystemProxyEnable));
    }

    #[test]
    fn a_request_still_replaces_an_incidental_failure() {
        let table = FailureTable::default();
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "a".into(),
        );
        table.record(
            FailedOperation::SystemProxyDisable,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "b".into(),
        );

        let entries = table.snapshot();
        assert_eq!(entries[0].operation, FailedOperation::SystemProxyDisable);
        assert!(table.retire_system_proxy(FailedOperation::SystemProxyDisable));
    }

    #[test]
    fn two_incidental_failures_still_replace_each_other() {
        let table = FailureTable::default();
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "first".into(),
        );
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "second".into(),
        );

        let entries = table.snapshot();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].detail, "second");
    }
}

tokio::task_local! {
    /// User-requested operation inherited by the current task.
    static ASKING_FOR: FailedOperation;
}

/// Run `operation` with the user's intent attached to whatever failure it produces.
pub async fn asking_for<T>(operation: FailedOperation, work: impl Future<Output = T>) -> T {
    ASKING_FOR.scope(operation, work).await
}

/// What the caller asked for, or a restore when nobody asked.
pub fn what_was_asked() -> FailedOperation {
    ASKING_FOR
        .try_with(|operation| *operation)
        .unwrap_or(FailedOperation::SystemProxyRestore)
}

static PENDING_FAILURES: LazyLock<FailureTable> = LazyLock::new(FailureTable::default);

/// A removal has a revision too, so a delayed read cannot restore a resolved failure.
#[derive(Debug, Default, Clone, serde::Serialize, specta::Type)]
pub struct SidecarFailureSnapshot {
    pub revision: u64,
    #[specta(type = Option<std::string::String>)]
    pub detail: Option<String>,
}

impl SidecarFailureSnapshot {
    fn record(&mut self, detail: String) {
        self.revision += 1;
        self.detail = Some(detail);
    }

    fn recover(&mut self) -> bool {
        if self.detail.take().is_none() {
            return false;
        }
        self.revision += 1;
        true
    }
}

static SIDECAR_FAILURE: LazyLock<Mutex<SidecarFailureSnapshot>> = LazyLock::new(Mutex::default);

pub fn sidecar_failure_snapshot() -> SidecarFailureSnapshot {
    SIDECAR_FAILURE.lock().clone()
}

pub fn record_sidecar_failure(detail: String) {
    SIDECAR_FAILURE.lock().record(detail);
    notify_pending_failures_changed();
}

pub fn retire_sidecar_failure() {
    let changed = SIDECAR_FAILURE.lock().recover();
    if changed {
        notify_pending_failures_changed();
    }
}

pub fn record_failure(operation: FailedOperation, code: &str, detail: impl Into<String>) {
    PENDING_FAILURES.record(operation, code, detail.into());
    notify_pending_failures_changed();
}

pub fn has_pending_failure(code: &str) -> bool {
    PENDING_FAILURES.entries.lock().map.contains_key(code)
}

/// Return unresolved failures oldest first without clearing them.
pub fn pending_failures() -> Vec<PendingFailure> {
    PENDING_FAILURES.snapshot()
}

/// Retire guard failures after replacement or shutdown.
pub fn retire_guard_failures() {
    if PENDING_FAILURES.retire_guard() {
        notify_pending_failures_changed();
    }
}

/// Retire failures resolved by a successful apply of what was asked.
pub fn retire_system_proxy_failures(asked: FailedOperation) {
    if PENDING_FAILURES.retire_system_proxy(asked) {
        notify_pending_failures_changed();
    }
}

/// Nudge the window to reread pending state; the event carries no payload.
fn notify_pending_failures_changed() {
    let Some(app_handle) = crate::APP_HANDLE.get() else {
        return;
    };
    NotificationSystem::send_event(app_handle.clone(), FrontendEvent::PendingFailuresChanged);
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
        serialize_frontend_event(event)
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

#[cfg(test)]
mod wire_tests {
    use super::*;

    #[test]
    fn frontend_event_wire_contract() -> Result<(), serde_json::Error> {
        let uid = String::from("profile");
        for (event, name, payload) in super::sample_frontend_events(&uid) {
            let (actual_name, actual_payload) = NotificationSystem::serialize_event(event);
            assert_eq!(actual_name, name);
            assert_eq!(actual_payload?, payload);
        }
        Ok(())
    }
}

/// One sample per `FrontendEvent` variant, paired with its wire name and payload.
#[cfg(test)]
fn sample_frontend_events(uid: &String) -> Vec<(FrontendEvent<'_>, &'static str, serde_json::Value)> {
    let state = crate::core::runstate::RunState {
        health: Default::default(),
        pending: None,
        sidecar_allowed: false,
        mode: crate::core::manager::RunningMode::NotRunning,
        is_admin: false,
        op_in_flight: false,
    }
    .to_view();
    vec![
        (
            FrontendEvent::RefreshClash,
            "verge://refresh-clash-config",
            json!("yes"),
        ),
        (
            FrontendEvent::RefreshVerge,
            "verge://refresh-verge-config",
            json!("yes"),
        ),
        (FrontendEvent::RefreshProfiles, "verge://refresh-profiles", json!("yes")),
        (
            FrontendEvent::RefreshProxyConfig,
            "verge://refresh-proxy-config",
            json!(null),
        ),
        (
            FrontendEvent::NoticeMessage {
                status: NoticeStatus::Info,
                message: Arc::from("ok"),
            },
            "verge://notice-message",
            json!(["info", "ok"]),
        ),
        (
            FrontendEvent::TimerUpdated { profile_index: uid },
            "verge://timer-updated",
            json!("profile"),
        ),
        (
            FrontendEvent::RunStateChanged { state: state.clone() },
            "verge://run-state-changed",
            serde_json::to_value(state).unwrap_or(serde_json::Value::Null),
        ),
        (
            FrontendEvent::PendingFailuresChanged,
            "verge://pending-failures-changed",
            json!(null),
        ),
        (
            FrontendEvent::ProfileChanged {
                current_profile_id: uid,
            },
            "profile-changed",
            json!("profile"),
        ),
        (
            FrontendEvent::ProfileUpdateStarted { uid },
            "profile-update-started",
            json!({"uid": "profile"}),
        ),
        (
            FrontendEvent::ProfileUpdateCompleted { uid },
            "profile-update-completed",
            json!({"uid": "profile"}),
        ),
    ]
}

macro_rules! frontend_events {
    ($( $field:ident: $payload:ty = $name:literal, $pattern:pat => $value:expr; )*) => {
        #[derive(serde::Serialize, specta::Type)]
        pub struct VergeEventPayloads {
            $(#[serde(rename = $name)] pub $field: $payload,)*
        }

        fn serialize_frontend_event(event: FrontendEvent) -> (&'static str, Result<serde_json::Value, serde_json::Error>) {
            match event {
                $($pattern => {
                    let payload: $payload = $value;
                    ($name, serde_json::to_value(payload))
                },)*
                #[cfg(target_os = "linux")]
                FrontendEvent::ThemeChanged { theme } => ("tauri://theme-changed", serde_json::to_value(theme)),
            }
        }
    };
}

frontend_events! {
    refresh_clash: std::string::String = "verge://refresh-clash-config", FrontendEvent::RefreshClash => "yes".to_owned();
    refresh_verge: std::string::String = "verge://refresh-verge-config", FrontendEvent::RefreshVerge => "yes".to_owned();
    refresh_profiles: std::string::String = "verge://refresh-profiles", FrontendEvent::RefreshProfiles => "yes".to_owned();
    refresh_proxy: () = "verge://refresh-proxy-config", FrontendEvent::RefreshProxyConfig => ();
    notice: (NoticeStatus, std::string::String) = "verge://notice-message", FrontendEvent::NoticeMessage { status, ref message } => (status, message.to_string());
    profile_changed: std::string::String = "profile-changed", FrontendEvent::ProfileChanged { current_profile_id } => current_profile_id.to_string();
    timer_updated: std::string::String = "verge://timer-updated", FrontendEvent::TimerUpdated { profile_index } => profile_index.to_string();
    profile_started: ProfileUpdatePayload = "profile-update-started", FrontendEvent::ProfileUpdateStarted { uid } => ProfileUpdatePayload { uid: uid.to_string() };
    profile_completed: ProfileUpdatePayload = "profile-update-completed", FrontendEvent::ProfileUpdateCompleted { uid } => ProfileUpdatePayload { uid: uid.to_string() };
    run_state: crate::core::runstate::RunStateView = "verge://run-state-changed", FrontendEvent::RunStateChanged { state } => state;
    pending_failures: () = "verge://pending-failures-changed", FrontendEvent::PendingFailuresChanged => ();
}

#[derive(serde::Serialize, specta::Type)]
pub struct ProfileUpdatePayload {
    pub uid: std::string::String,
}

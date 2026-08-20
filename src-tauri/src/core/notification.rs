use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::json;
use smartstring::alias::String;
use std::{
    collections::HashMap,
    future::Future,
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Emitter as _, Manager as _, WebviewWindow};

#[derive(Debug)]
pub enum FrontendEvent<'a> {
    RefreshClash,
    RefreshVerge,
    RefreshProfiles,
    RefreshProxyConfig,
    NoticeMessage {
        status: &'a str,
        message: String,
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
        state: serde_json::Value,
    },
    PendingFailuresChanged,
    #[cfg(target_os = "linux")]
    ThemeChanged {
        theme: tauri::Theme,
    },
}

/// Operation associated with a pending failure.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
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

    /// Whether reaching `enabled` resolves this operation's failure.
    const fn retired_by_system_proxy_success(self, enabled: bool) -> bool {
        match self {
            Self::SystemProxyEnable => enabled,
            Self::SystemProxyDisable => !enabled,
            Self::SystemProxyRestore => true,
            // Only replacing or stopping the guard resolves its failure.
            Self::SystemProxyGuard => false,
        }
    }
}

/// Latest unresolved failure for one stable code.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingFailure {
    /// Stable code used as the table key.
    pub code: String,
    /// Full diagnostic context chain.
    pub detail: String,
    pub operation: FailedOperation,
    /// Monotonic identity for repeated failures under the same code.
    pub sequence: u64,
}

/// Non-destructive pending state, indexed by stable code.
#[derive(Debug, Default)]
struct FailureTable {
    entries: Mutex<HashMap<String, PendingFailure>>,
    sequence: AtomicU64,
}

impl FailureTable {
    fn record(&self, operation: FailedOperation, code: &str, detail: String) {
        // Sequence assignment and replacement must share one ordering lock.
        let mut entries = self.entries.lock();
        // Preserve an unanswered request over a later restore.
        let operation = entries
            .get(code)
            .filter(|existing| existing.operation.outranks(operation))
            .map_or(operation, |existing| existing.operation);
        let failure = PendingFailure {
            code: code.into(),
            detail,
            operation,
            sequence: self.sequence.fetch_add(1, Ordering::AcqRel).wrapping_add(1),
        };
        entries.insert(code.into(), failure);
    }

    fn snapshot(&self) -> Vec<PendingFailure> {
        let mut failures: Vec<PendingFailure> = self.entries.lock().values().cloned().collect();
        failures.sort_by_key(|failure| failure.sequence);
        failures
    }

    /// Return whether a guard failure was retired.
    fn retire_guard(&self) -> bool {
        let mut entries = self.entries.lock();
        let before = entries.len();
        entries.retain(|_, failure| failure.operation != FailedOperation::SystemProxyGuard);
        before != entries.len()
    }

    /// Return whether any proxy failure was retired.
    fn retire_system_proxy(&self, enabled: bool) -> bool {
        let mut entries = self.entries.lock();
        let before = entries.len();
        entries.retain(|_, failure| !failure.operation.retired_by_system_proxy_success(enabled));
        before != entries.len()
    }
}

#[cfg(test)]
mod failure_table_tests {
    use super::{FailedOperation, FailureTable};

    #[tokio::test]
    async fn a_write_nobody_asked_for_is_a_restore() {
        assert_eq!(super::what_was_asked(), FailedOperation::SystemProxyRestore);
    }

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

        assert!(!table.retire_system_proxy(false));
        assert!(table.retire_system_proxy(true));
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
        assert!(!table.retire_system_proxy(true));
        assert!(table.retire_system_proxy(false));
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

static PENDING_FAILURES: Lazy<FailureTable> = Lazy::new(FailureTable::default);

pub fn record_failure(operation: FailedOperation, code: &str, detail: impl Into<String>) {
    PENDING_FAILURES.record(operation, code, detail.into());
    notify_pending_failures_changed();
}

pub fn has_pending_failure(code: &str) -> bool {
    PENDING_FAILURES.entries.lock().contains_key(code)
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

/// Retire failures resolved by the resulting proxy state.
pub fn retire_system_proxy_failures(enabled: bool) {
    if PENDING_FAILURES.retire_system_proxy(enabled) {
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
        match event {
            FrontendEvent::RefreshClash => ("verge://refresh-clash-config", Ok(json!("yes"))),
            FrontendEvent::RefreshVerge => ("verge://refresh-verge-config", Ok(json!("yes"))),
            FrontendEvent::RefreshProfiles => ("verge://refresh-profiles", Ok(json!("yes"))),
            FrontendEvent::RefreshProxyConfig => ("verge://refresh-proxy-config", Ok(serde_json::Value::Null)),
            FrontendEvent::NoticeMessage { status, message } => {
                ("verge://notice-message", serde_json::to_value((status, message)))
            }
            FrontendEvent::ProfileChanged { current_profile_id } => ("profile-changed", Ok(json!(current_profile_id))),
            FrontendEvent::TimerUpdated { profile_index } => ("verge://timer-updated", Ok(json!(profile_index))),
            FrontendEvent::ProfileUpdateStarted { uid } => ("profile-update-started", Ok(json!({ "uid": uid }))),
            FrontendEvent::ProfileUpdateCompleted { uid } => ("profile-update-completed", Ok(json!({ "uid": uid }))),
            FrontendEvent::RunStateChanged { state } => ("verge://run-state-changed", Ok(state)),
            FrontendEvent::PendingFailuresChanged => ("verge://pending-failures-changed", Ok(serde_json::Value::Null)),
            #[cfg(target_os = "linux")]
            FrontendEvent::ThemeChanged { theme } => ("tauri://theme-changed", serde_json::to_value(theme)),
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

#[cfg(test)]
mod tests {
    use super::{FailedOperation, FailureTable};

    fn table() -> FailureTable {
        FailureTable::default()
    }

    #[test]
    fn reading_does_not_clear() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "refused".into(),
        );

        assert_eq!(table.snapshot(), table.snapshot());
        assert_eq!(table.snapshot().len(), 1);
    }

    #[test]
    fn a_code_keeps_only_its_most_recent_failure() {
        let table = table();
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

        let failures = table.snapshot();
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].detail, "second");
    }

    #[test]
    fn a_new_failure_under_a_known_code_gets_a_new_sequence() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_DIRECT_FALLBACK",
            "a".into(),
        );
        let first = table.snapshot()[0].sequence;
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_DIRECT_FALLBACK",
            "b".into(),
        );

        assert!(table.snapshot()[0].sequence > first);
    }

    #[test]
    fn failures_are_reported_oldest_first() {
        let table = table();
        table.record(FailedOperation::SystemProxyRestore, "FIRST", "a".into());
        table.record(FailedOperation::SystemProxyRestore, "SECOND", "b".into());

        let failures = table.snapshot();
        let codes: Vec<&str> = failures.iter().map(|failure| failure.code.as_str()).collect();
        assert_eq!(codes, ["FIRST", "SECOND"]);
    }

    #[test]
    fn a_working_proxy_retires_what_it_disproves() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyRestore,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "refused".into(),
        );

        assert!(table.retire_system_proxy(false));
        assert!(table.snapshot().is_empty());
    }

    #[test]
    fn a_users_request_is_retired_only_by_reaching_the_state_they_asked_for() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyDisable,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "refused".into(),
        );

        assert!(!table.retire_system_proxy(true));
        assert_eq!(table.snapshot().len(), 1);

        assert!(table.retire_system_proxy(false));
        assert!(table.snapshot().is_empty());
    }

    #[test]
    fn a_failed_enable_is_retired_by_the_proxy_coming_on() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyEnable,
            "SYSPROXY_DIRECT_FALLBACK",
            "fell back".into(),
        );

        assert!(!table.retire_system_proxy(false));
        assert!(table.retire_system_proxy(true));
        assert!(table.snapshot().is_empty());
    }

    #[test]
    fn a_stopped_guard_is_retired_by_a_guard_starting_again_and_not_by_an_apply() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyGuard,
            "SYSPROXY_GUARD_STOPPED",
            "gave up".into(),
        );

        assert!(!table.retire_system_proxy(true));
        assert!(!table.retire_system_proxy(false));
        assert_eq!(table.snapshot().len(), 1);

        assert!(table.retire_guard());
        assert!(table.snapshot().is_empty());
    }

    #[test]
    fn retiring_a_guard_leaves_everything_else_alone() {
        let table = table();
        table.record(
            FailedOperation::SystemProxyEnable,
            "SYSPROXY_PRIVILEGE_REQUIRED",
            "refused".into(),
        );

        assert!(!table.retire_guard());
        assert_eq!(table.snapshot().len(), 1);
    }

    #[test]
    fn retiring_nothing_reports_nothing() {
        assert!(!table().retire_system_proxy(true));
    }
}

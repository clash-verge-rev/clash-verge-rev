use crate::core::{
    notification::{self, PendingFailure},
    runstate::{RUN_STATE, RunStateView},
};

/// The whole Run State in one call.
///
/// Replaces the separate running-mode and service-install-state commands: they were three
/// caches on three refresh intervals describing one fact, which the frontend then had to keep
/// coherent by hand.
#[tauri::command]
pub async fn get_runtime_state() -> Result<RunStateView, String> {
    Ok(RUN_STATE.settled().await.to_view())
}

/// Return unresolved failures without consuming them.
#[tauri::command]
pub async fn get_pending_failures() -> Vec<PendingFailure> {
    notification::pending_failures()
}

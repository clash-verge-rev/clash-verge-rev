use super::super::state::SWITCH_CLEANUP_TIMEOUT;
use crate::{core::handle, logging, process::AsyncHandler, utils::logging::Type};
use smartstring::alias::String as SmartString;
use tokio::time;

pub(crate) type CleanupHandle = tauri::async_runtime::JoinHandle<()>;

pub(crate) fn schedule_post_switch_success(
    profile_id: SmartString,
    success: bool,
    notify: bool,
    task_id: u64,
) -> CleanupHandle {
    // Post-success cleanup runs detached from the driver so the queue keeps moving.
    AsyncHandler::spawn(move || async move {
        handle::Handle::notify_profile_switch_finished(
            profile_id.clone(),
            success,
            notify,
            task_id,
        );
        if success {
            close_connections_after_switch(profile_id).await;
        }
    })
}

pub(crate) fn schedule_post_switch_failure(
    profile_id: SmartString,
    notify: bool,
    task_id: u64,
) -> CleanupHandle {
    // Failures or cancellations do not alter the active profile, so skip draining live connections.
    AsyncHandler::spawn(move || async move {
        handle::Handle::notify_profile_switch_finished(profile_id.clone(), false, notify, task_id);
    })
}

async fn close_connections_after_switch(profile_id: SmartString) {
    match time::timeout(SWITCH_CLEANUP_TIMEOUT, async {
        handle::Handle::mihomo().await.close_all_connections().await
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            logging!(
                warn,
                Type::Cmd,
                "Failed to close connections after profile switch ({}): {}",
                profile_id,
                err
            );
        }
        Err(_) => {
            logging!(
                warn,
                Type::Cmd,
                "Closing connections after profile switch ({}) timed out after {:?}",
                profile_id,
                SWITCH_CLEANUP_TIMEOUT
            );
        }
    }
}

// Profile switch orchestration: plumbing between the public tauri commands,
// the async driver queue, validation helpers, and the state machine workflow.
mod driver;
mod state;
mod validation;
mod workflow;

pub use state::{ProfileSwitchStatus, SwitchResultEvent};

use smartstring::alias::String;

use super::CmdResult;

pub(super) async fn patch_profiles_config(profiles: crate::config::IProfiles) -> CmdResult<bool> {
    workflow::patch_profiles_config(profiles).await
}

pub(super) async fn patch_profiles_config_by_profile_index(
    profile_index: String,
) -> CmdResult<bool> {
    driver::switch_profile_and_wait(profile_index, false).await
}

pub(super) async fn switch_profile(profile_index: String, notify_success: bool) -> CmdResult<bool> {
    driver::switch_profile(profile_index, notify_success).await
}

pub(super) fn get_switch_status() -> CmdResult<ProfileSwitchStatus> {
    Ok(state::manager().status_snapshot())
}

pub(super) fn get_switch_events(after_sequence: u64) -> CmdResult<Vec<SwitchResultEvent>> {
    Ok(state::manager().events_after(after_sequence))
}

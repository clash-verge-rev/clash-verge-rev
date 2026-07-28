//! Turning TUN off when it stops being possible.
//!
//! The decision is [`RunState::tun_should_be_disabled`]; this is the action it triggers. They
//! are separate because the decision is a question about Service capability, which Run State
//! owns, while writing user configuration is not something Run State should do.

use std::sync::atomic::{AtomicBool, Ordering};

use clash_verge_draft::DraftBusy;
use clash_verge_logging::{Type, logging};
use scopeguard::defer;

use crate::{
    config::{Config, IVerge},
    core::{handle::Handle, manager::RunningMode, runstate::RUN_STATE},
};

/// Set while a disable is being written.
///
/// Patching the config produces further Run State transitions, each of which reconciles again;
/// without this the first loss of capability would start an unbounded cascade. Cleared on the
/// way out however that happens — an early return, an error, or a panic — because a flag stuck
/// on would silence every later reconciliation for the life of the process.
static DISABLING_TUN: AtomicBool = AtomicBool::new(false);

/// Turn TUN off if the Run State says it cannot work.
///
/// Reads the current Run State rather than taking a snapshot: this is invoked from a spawned
/// task, so whatever transition triggered it may be several states out of date by the time it
/// runs, and acting on a stale "cannot work" is how a transient startup state would silently
/// rewrite the user's configuration.
///
/// A no-op in every case except a settled one, so it is safe to call on every transition.
pub async fn reconcile_tun_availability() {
    let state = RUN_STATE.state();

    // Before the Core is running the startup decision has not been taken yet: the Service may
    // be about to be installed, and `prepare_startup` reads `enable_tun_mode` to decide
    // whether to ask. Turning TUN off here would both undo the user's setting and remove the
    // very prompt that would have made it work.
    if matches!(state.mode, RunningMode::NotRunning) {
        return;
    }

    // Falling back to Sidecar already suppresses TUN for this session. That is deliberately
    // not a persistent change — `Config::disable_tun_and_persist` is the separate, explicit
    // act — so honour the decision that was already taken rather than escalating it.
    if Config::tun_suppressed_for_session() {
        return;
    }

    let tun_enabled = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
    if !state.tun_should_be_disabled(tun_enabled) {
        return;
    }

    if DISABLING_TUN.swap(true, Ordering::AcqRel) {
        return;
    }
    defer! {
        DISABLING_TUN.store(false, Ordering::Release);
    }

    logging!(
        info,
        Type::Core,
        "TUN mode cannot work in the current run state; turning it off"
    );
    let patch = IVerge {
        enable_tun_mode: Some(false),
        ..IVerge::default()
    };

    match super::patch_verge(&patch, false).await {
        Ok(()) => Handle::notice_message("tun_mode::auto_disabled", ""),
        // Losing the race for the config layer is not a failure the user can act on: this runs
        // on every Run State transition and again whenever the setting itself is patched, so
        // the writer that won will be followed by another reconciliation. Telling the user that
        // turning TUN off "failed" would be both alarming and wrong.
        Err(error) if error.downcast_ref::<DraftBusy>().is_some() => {
            logging!(
                debug,
                Type::Core,
                "deferring the TUN reconciliation, configuration is busy: {error:#}"
            );
        }
        Err(error) => {
            logging!(error, Type::Core, "failed to turn TUN mode off: {error:#}");
            Handle::notice_message("tun_mode::auto_disable_failed", "");
        }
    }
}

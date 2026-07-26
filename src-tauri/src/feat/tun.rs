//! Turning TUN off when it stops being possible.
//!
//! The decision is [`RunState::tun_should_be_disabled`]; this is the action it triggers. They
//! are separate because the decision is a question about Service capability, which Run State
//! owns, while writing user configuration is not something Run State should do — see
//! `docs/adr/0001-runstate-owns-state-not-lifecycle.md`.

use std::sync::atomic::{AtomicBool, Ordering};

use clash_verge_logging::{Type, logging};

use crate::{
    config::{Config, IVerge},
    core::{handle::Handle, runstate::RunState},
};

/// Set while a disable is being written.
///
/// Patching the config produces further Run State transitions, each of which reconciles again;
/// without this the first loss of capability would start an unbounded cascade. The frontend
/// guard this replaces needed a one-second cooldown timer for the same reason — a flag is
/// exact where a timer was a guess.
static DISABLING_TUN: AtomicBool = AtomicBool::new(false);

/// Turn TUN off if the Run State says it cannot work.
///
/// A no-op in every other case, including "we do not know yet", so it is safe to call on every
/// transition.
pub async fn reconcile_tun_availability(state: &RunState) {
    let tun_enabled = Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false);
    if !state.tun_should_be_disabled(tun_enabled) {
        return;
    }
    if DISABLING_TUN.swap(true, Ordering::AcqRel) {
        return;
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
    let result = super::patch_verge(&patch, false).await;
    DISABLING_TUN.store(false, Ordering::Release);

    match result {
        Ok(()) => Handle::notice_message("tun_mode::auto_disabled", ""),
        Err(error) => {
            logging!(error, Type::Core, "failed to turn TUN mode off: {error:#}");
            Handle::notice_message("tun_mode::auto_disable_failed", "");
        }
    }
}

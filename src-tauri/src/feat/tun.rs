//! Disables TUN when the current Run State cannot support it.

use std::sync::atomic::{AtomicBool, Ordering};

use clash_verge_logging::{Type, logging};
use scopeguard::defer;

use crate::{
    config::{Config, IVerge},
    core::{handle::Handle, manager::RunningMode, runstate::RUN_STATE},
};

/// Set while an automatic TUN disable is being written.
///
/// Drops new requests during the write to prevent recursive retries. No-op reconciliations leave
/// it clear so later state changes can still be processed.
static DISABLING_TUN: AtomicBool = AtomicBool::new(false);

/// Disable TUN when the current settled Run State cannot support it.
pub async fn reconcile_tun_availability() {
    // Coalesce all reconciliation requests while a disable write is in flight.
    if DISABLING_TUN.load(Ordering::Acquire) {
        return;
    }

    // Wait for any config transaction, then decide from fresh state and committed config.
    let config_write = Config::lock_config_write().await;
    let state = RUN_STATE.state();

    // Startup may still install the Service and uses this setting to decide whether to prompt.
    if matches!(state.mode, RunningMode::NotRunning) {
        return;
    }

    // Sidecar fallback suppresses TUN for this session without changing the saved preference.
    if Config::tun_suppressed_for_session() {
        return;
    }

    // Do not rewrite the saved preference based on an uncommitted draft from a legacy writer.
    let tun_enabled = Config::verge().await.data_arc().enable_tun_mode.unwrap_or(false);
    if !state.tun_should_be_disabled(tun_enabled) {
        return;
    }

    // The config lock already serializes writers; the flag only sheds newly spawned work.
    DISABLING_TUN.store(true, Ordering::Release);
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

    // Avoid recursively reconciling this internal patch.
    match super::apply_verge_patch_locked(&config_write, &patch, false).await {
        Ok(()) => Handle::notice_message("tun_mode::auto_disabled", ""),
        Err(error) => {
            logging!(error, Type::Core, "failed to turn TUN mode off: {error:#}");
            Handle::notice_message("tun_mode::auto_disable_failed", "");
        }
    }
}

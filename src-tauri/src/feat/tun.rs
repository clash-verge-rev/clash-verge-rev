//! Reconciles TUN with current Core and Service availability.

use std::sync::atomic::{AtomicBool, Ordering};

use clash_verge_logging::{Type, logging};
use scopeguard::defer;

use crate::{
    config::{Config, IVerge},
    core::{handle::Handle, manager::RunningMode, runstate::RUN_STATE},
};

/// Prevents recursive runtime disable writes.
static DISABLING_TUN: AtomicBool = AtomicBool::new(false);

/// Suppress TUN for this Windows session when startup confirms the Service is absent.
/// The saved preference remains available for a later Service install.
pub async fn reconcile_startup_tun_availability() {
    if !cfg!(target_os = "windows") {
        return;
    }

    // Read fresh state after prior config writes complete.
    let _config_write = Config::lock_config_write().await;
    let tun_enabled = Config::verge().await.data_arc().enable_tun_mode.unwrap_or(false);
    if !RUN_STATE.state().startup_tun_should_be_disabled(tun_enabled) {
        return;
    }

    logging!(
        info,
        Type::Setup,
        "Windows Service is not installed; suppressing TUN mode so the Core can start on Sidecar"
    );
    Config::suppress_tun_for_session().await;
}

/// Disable TUN when the current settled Run State cannot support it.
pub async fn reconcile_tun_availability() {
    if DISABLING_TUN.load(Ordering::Acquire) {
        return;
    }

    // Re-read state and committed config after prior writes complete.
    let config_write = Config::lock_config_write().await;
    let state = RUN_STATE.state();

    // Startup uses the narrower session-suppression path above.
    if matches!(state.mode, RunningMode::NotRunning) {
        return;
    }

    if Config::tun_suppressed_for_session() {
        return;
    }

    // Legacy writers may still hold an uncommitted draft.
    let tun_enabled = Config::verge().await.data_arc().enable_tun_mode.unwrap_or(false);
    if !state.tun_should_be_disabled(tun_enabled) {
        return;
    }

    // The flag coalesces newly spawned tasks while the config lock serializes writers.
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

    // Skip recursive reconciliation for this internal patch.
    match super::apply_verge_patch_locked(&config_write, &patch, false).await {
        Ok(()) => Handle::notice_message("tun_mode::auto_disabled", ""),
        Err(error) => {
            logging!(error, Type::Core, "failed to turn TUN mode off: {error:#}");
            Handle::notice_message("tun_mode::auto_disable_failed", "");
        }
    }
}

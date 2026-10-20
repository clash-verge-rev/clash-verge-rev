//! Policy for the persisted `ipv6_mode` setting and the physical-underlay watcher.
//!
//! `off` and `on` are explicit. `auto` enables the generated top-level `ipv6` only while a
//! physical interface has a usable IPv6 address; a network change or a slow fallback tick
//! re-probes and regenerates the runtime config only when the effective value changed. The
//! persisted mode is never rewritten, so transient network state cannot edit user settings.

#[cfg(unix)]
use crate::config::Config;
#[cfg(unix)]
use crate::core::{CoreManager, handle::Handle, manager::RunningMode, runstate::RUN_STATE};
use crate::process::AsyncHandler;
#[cfg(unix)]
use clash_verge_logging::{Type, logging};
use std::{
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::mpsc;

const MODE_OFF: &str = "off";
const MODE_ON: &str = "on";
const MODE_AUTO: &str = "auto";

/// Network changes arrive in bursts (interface, DHCP prefix, default route); let them settle.
const DEBOUNCE: Duration = Duration::from_secs(2);
/// Notifications can be missed (sleep/wake, service restarts), so verify periodically.
const FALLBACK_INTERVAL: Duration = Duration::from_secs(60);

static STARTED: AtomicBool = AtomicBool::new(false);
static TRIGGER: OnceLock<mpsc::UnboundedSender<()>> = OnceLock::new();

/// Auto detection is implemented for unix only; elsewhere `auto` keeps the legacy switch.
pub(crate) const fn supported() -> bool {
    cfg!(unix)
}

pub(crate) fn is_auto(mode: Option<&str>) -> bool {
    matches!(mode.map(str::trim), Some(MODE_AUTO))
}

/// Effective top-level `ipv6` for a generated config.
pub(crate) fn effective_ipv6(mode: Option<&str>, legacy: bool) -> bool {
    #[cfg(unix)]
    {
        resolve(mode, legacy, super::ipv6_detect::cached())
    }
    #[cfg(not(unix))]
    {
        match mode.map(str::trim) {
            Some(MODE_ON) => true,
            Some(MODE_OFF) => false,
            _ => legacy,
        }
    }
}

#[cfg(unix)]
fn resolve(mode: Option<&str>, legacy: bool, underlay: super::ipv6_detect::Ipv6Underlay) -> bool {
    use super::ipv6_detect::Ipv6Underlay;

    match mode.map(str::trim) {
        Some(MODE_ON) => true,
        Some(MODE_OFF) => false,
        // An unprobed or unusable underlay must not advertise IPv6 to applications.
        Some(MODE_AUTO) => underlay == Ipv6Underlay::Available,
        _ => legacy,
    }
}

/// Probe once before the first runtime config generation, so `auto` does not start from an
/// unknown underlay.
pub(crate) fn initialize() {
    #[cfg(unix)]
    {
        let underlay = super::ipv6_detect::probe();
        super::ipv6_detect::store(underlay);
        logging!(debug, Type::Core, "IPv6 auto: underlay at startup is {underlay:?}");
    }
}

/// Subscribe to network changes and apply detection results while the app is running.
///
/// macOS change notifications arrive through [`crate::core::network_watch`]; other platforms
/// rely on the fallback tick. Registered before the Core starts.
pub(crate) fn start() {
    if !supported() || STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    let (trigger, mut changes) = mpsc::unbounded_channel();
    if TRIGGER.set(trigger).is_err() {
        return;
    }
    // A change may have landed between the startup probe and this subscription, and an early
    // notification was dropped because the channel did not exist yet: reconcile once on start.
    note_network_change();

    AsyncHandler::spawn(move || async move {
        let mut fallback = tokio::time::interval(FALLBACK_INTERVAL);
        fallback.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // The first tick is immediate; startup already generated a config from `initialize`.
        fallback.tick().await;
        loop {
            tokio::select! {
                _ = fallback.tick() => {}
                Some(()) = changes.recv() => {
                    tokio::time::sleep(DEBOUNCE).await;
                    while changes.try_recv().is_ok() {}
                }
            }
            reconcile().await;
        }
    });
}

/// Ask the watcher to re-probe soon. Safe to call before `start` (no-op).
pub(crate) fn note_network_change() {
    if let Some(trigger) = TRIGGER.get() {
        let _ = trigger.send(());
    }
}

#[cfg(unix)]
async fn reconcile() {
    use super::ipv6_detect::{self, Ipv6Underlay};
    use serde_yaml_ng::Value;

    let previous = ipv6_detect::cached();
    let probed = AsyncHandler::spawn_blocking(ipv6_detect::probe)
        .await
        .unwrap_or(Ipv6Underlay::Unknown);
    // A failed probe says nothing about the underlay; keep the last stable answer and let the
    // fallback tick try again instead of dropping IPv6 on a transient read error.
    let detected = if probed == Ipv6Underlay::Unknown {
        logging!(warn, Type::Core, "IPv6 auto: probe failed; keeping {previous:?}");
        previous
    } else {
        probed
    };
    ipv6_detect::store(detected);
    if detected != previous {
        logging!(
            info,
            Type::Core,
            "IPv6 auto: physical underlay changed {previous:?} -> {detected:?}"
        );
    }

    let mode = Config::verge().await.latest_arc().ipv6_mode.clone();
    if !is_auto(mode.as_deref()) || matches!(RUN_STATE.state().mode, RunningMode::NotRunning) {
        return;
    }
    let desired = effective_ipv6(mode.as_deref(), false);
    let current = Config::runtime()
        .await
        .latest_arc()
        .config
        .as_ref()
        .and_then(|config| config.get("ipv6"))
        .and_then(Value::as_bool);
    if current == Some(desired) {
        return;
    }

    // Configuration writes own this transition: re-check both mode and Core state under the
    // lock, because a user change may have landed while we waited for it.
    let _config_write = Config::lock_config_write().await;
    let mode = Config::verge().await.latest_arc().ipv6_mode.clone();
    if !is_auto(mode.as_deref()) || matches!(RUN_STATE.state().mode, RunningMode::NotRunning) {
        return;
    }

    logging!(info, Type::Core, "IPv6 auto: applying effective ipv6={desired}");
    match CoreManager::global().update_config_forced().await {
        Ok(outcome) if outcome.is_valid() => {
            Handle::refresh_clash();
            logging!(debug, Type::Core, "IPv6 auto: effective ipv6={desired} applied");
        }
        Ok(outcome) => logging!(warn, Type::Core, "IPv6 auto: configuration was not applied: {outcome}"),
        Err(error) => logging!(warn, Type::Core, "IPv6 auto: failed to apply effective ipv6: {error:#}"),
    }
}

#[cfg(not(unix))]
async fn reconcile() {}

#[cfg(all(test, unix))]
#[allow(clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::{MODE_AUTO, MODE_OFF, MODE_ON, resolve};
    use crate::core::ipv6_detect::Ipv6Underlay;

    const UNDERLAYS: [Ipv6Underlay; 3] = [
        Ipv6Underlay::Available,
        Ipv6Underlay::Unavailable,
        Ipv6Underlay::Unknown,
    ];

    #[test]
    fn explicit_modes_ignore_detection() {
        for underlay in UNDERLAYS {
            assert!(resolve(Some(MODE_ON), false, underlay), "on is always enabled");
            assert!(!resolve(Some(MODE_OFF), true, underlay), "off is always disabled");
        }
    }

    #[test]
    fn auto_requires_a_usable_underlay() {
        assert!(resolve(Some(MODE_AUTO), false, Ipv6Underlay::Available));
        assert!(!resolve(Some(MODE_AUTO), true, Ipv6Underlay::Unavailable));
        assert!(
            !resolve(Some(MODE_AUTO), true, Ipv6Underlay::Unknown),
            "an unprobed underlay is unsafe to advertise"
        );
    }

    #[test]
    fn absent_or_unknown_modes_keep_the_legacy_switch() {
        assert!(resolve(None, true, Ipv6Underlay::Unavailable));
        assert!(!resolve(None, false, Ipv6Underlay::Available));
        assert!(resolve(Some("something-else"), true, Ipv6Underlay::Unavailable));
    }
}

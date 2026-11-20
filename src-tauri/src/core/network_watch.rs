//! Re-apply the system proxy when macOS gains or switches its primary network service.
//!
//! Proxy settings live per network service. A write that found no service wrote nothing, and a
//! switch to another service leaves the proxy on the old one; both need the write repeated.

use crate::{
    config::Config,
    core::{CoreManager, manager::RunningMode, proxy_control, service},
    process::AsyncHandler,
};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use sysproxy::NetworkServiceMonitor;
use system_configuration::{
    core_foundation::{
        base::{CFType, TCFType as _},
        dictionary::CFDictionary,
        string::CFString,
    },
    dynamic_store::SCDynamicStoreBuilder,
};

static MONITOR: Mutex<Option<NetworkServiceMonitor>> = Mutex::new(None);
static CHANGES: Mutex<NetworkChanges> = Mutex::new(NetworkChanges { applied: None });

#[derive(Clone, Debug, PartialEq, Eq)]
struct RestoreTarget {
    service: String,
    interface: Option<String>,
    mode: RunningMode,
    readiness_generation: u64,
    owner_generation: Option<u64>,
}

#[derive(Default)]
struct NetworkChanges {
    applied: Option<RestoreTarget>,
}

impl NetworkChanges {
    fn needs_restore(&mut self, current: &Option<RestoreTarget>) -> bool {
        if current.is_some() && self.applied.as_ref() == current.as_ref() {
            return false;
        }
        self.applied = None;
        true
    }

    fn record_restore(&mut self, before: Option<RestoreTarget>, after: Option<RestoreTarget>, completed: bool) {
        self.applied = if completed && before == after { before } else { None };
    }
}

pub(crate) fn invalidate() {
    CHANGES.lock().applied = None;
}

async fn current_target() -> Option<RestoreTarget> {
    let (service, interface) = tokio::task::spawn_blocking(|| {
        let store = SCDynamicStoreBuilder::new("clash-verge network watch").build()?;
        let dictionary = store
            .get(CFString::from_static_string("State:/Network/Global/IPv4"))?
            .downcast_into::<CFDictionary>()?;
        let field = |name| {
            let key = CFString::from_static_string(name);
            let value = dictionary.find(key.as_CFTypeRef().cast())?;
            unsafe { CFType::wrap_under_get_rule(*value) }
                .downcast_into::<CFString>()
                .map(|value| value.to_string())
        };
        Some((field("PrimaryService")?, field("PrimaryInterface")))
    })
    .await
    .ok()??;
    let manager = CoreManager::global();
    let mode = *manager.get_running_mode();
    if matches!(mode, RunningMode::NotRunning) {
        return None;
    }
    Some(RestoreTarget {
        service,
        interface,
        mode,
        readiness_generation: manager.current_core_readiness_generation()?,
        owner_generation: matches!(mode, RunningMode::Service).then(service::owner_monitor_generation),
    })
}

pub fn is_armed() -> bool {
    MONITOR.lock().is_some()
}

/// Subscribe to the primary IPv4 service on the main run loop. Armed on return, so a service
/// appearing from here on is never missed.
pub fn start() {
    match NetworkServiceMonitor::start(|| {
        AsyncHandler::spawn(reapply);
    }) {
        Ok(monitor) => {
            *MONITOR.lock() = Some(monitor);
            logging!(
                debug,
                Type::Core,
                "network watch armed; the system proxy is re-applied on network changes"
            );
        }
        Err(error) => logging!(
            warn,
            Type::Core,
            "could not watch the network; the proxy is not re-applied on changes: {error}"
        ),
    }
}

async fn reapply() {
    // Config lock first, then lifecycle: the repo's order. Holding both also means the config
    // read below is committed state, not a patch that may still roll back.
    let _config_write = Config::lock_config_write().await;
    let manager = CoreManager::global();
    let _life = manager.lifecycle_lock.lock().await;
    // Checked under the locks: a task that queued behind a restart may be stale by now.
    if !Config::verge()
        .await
        .latest_arc()
        .enable_system_proxy
        .unwrap_or_default()
    {
        invalidate();
        crate::utils::resolve::dns::sync_public_dns().await;
        return;
    }
    if !proxy_control::has_network_service().await {
        invalidate();
        logging!(
            debug,
            Type::Core,
            "network changed without a service to write the proxy on; waiting for the next change"
        );
        return;
    }
    let before = current_target().await;
    let needs_restore = CHANGES.lock().needs_restore(&before);
    if !needs_restore {
        // Same-service proxy enforcement belongs to the guard; DNS still follows TUN state.
        crate::utils::resolve::dns::sync_public_dns().await;
        return;
    }
    match manager.restore_system_proxy().await {
        Ok(completed) => {
            let after = current_target().await;
            CHANGES.lock().record_restore(before, after, completed);
        }
        Err(error) => logging!(
            warn,
            Type::Core,
            "failed to re-apply the system proxy after a network change: {error:#}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{NetworkChanges, RestoreTarget};
    use crate::core::manager::RunningMode;

    fn target() -> RestoreTarget {
        RestoreTarget {
            service: "wifi".to_owned(),
            interface: Some("en0".to_owned()),
            mode: RunningMode::Service,
            readiness_generation: 1,
            owner_generation: Some(1),
        }
    }

    #[test]
    fn only_the_same_network_and_core_owner_skip_a_completed_restore() {
        let original = target();
        let mut changes = NetworkChanges::default();
        assert!(changes.needs_restore(&Some(original.clone())));
        changes.record_restore(Some(original.clone()), Some(original.clone()), true);
        assert!(!changes.needs_restore(&Some(original.clone())));
        assert!(!changes.needs_restore(&Some(original.clone())));

        let mut switched = original.clone();
        switched.service = "ethernet".to_owned();
        let mut interface = original.clone();
        interface.interface = Some("en1".to_owned());
        let mut restarted = original.clone();
        restarted.readiness_generation = 2;
        let mut owner = original.clone();
        owner.owner_generation = Some(2);
        let mut sidecar = original.clone();
        sidecar.mode = RunningMode::Sidecar;
        sidecar.owner_generation = None;
        for current in [
            None,
            Some(switched),
            Some(interface),
            Some(restarted),
            Some(owner),
            Some(sidecar),
        ] {
            changes.record_restore(Some(original.clone()), Some(original.clone()), true);
            assert!(changes.needs_restore(&current));
            assert!(changes.needs_restore(&Some(original.clone())));
        }
    }

    #[test]
    fn incomplete_or_racing_restores_do_not_suppress_the_next_network_event() {
        let original = target();
        let mut switched = original.clone();
        switched.service = "ethernet".to_owned();
        let mut changes = NetworkChanges::default();
        for (after, completed) in [(Some(original.clone()), false), (Some(switched), true), (None, true)] {
            changes.record_restore(Some(original.clone()), after, completed);
            assert!(changes.needs_restore(&Some(original.clone())));
        }
        changes.record_restore(Some(original.clone()), Some(original.clone()), true);
        assert!(!changes.needs_restore(&Some(original.clone())));
        assert!(changes.needs_restore(&None));
        // A failed restore has no completion to record.
        assert!(changes.needs_restore(&Some(original)));
    }
}

//! Re-apply the system proxy when macOS gains or switches its primary network service.
//!
//! Proxy settings live per network service. A write that found no service wrote nothing, and a
//! switch to another service leaves the proxy on the old one; both need the write repeated.

use crate::{config::Config, core::CoreManager, core::proxy_control, process::AsyncHandler};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use sysproxy::NetworkServiceMonitor;

static MONITOR: Mutex<Option<NetworkServiceMonitor>> = Mutex::new(None);

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
        return;
    }
    if !proxy_control::has_network_service().await {
        logging!(
            debug,
            Type::Core,
            "network changed without a service to write the proxy on; waiting for the next change"
        );
        return;
    }
    if let Err(error) = manager.apply_proxy_after_start().await {
        logging!(
            warn,
            Type::Core,
            "failed to re-apply the system proxy after a network change: {error:#}"
        );
    }
}

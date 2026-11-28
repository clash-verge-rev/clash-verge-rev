//! Re-apply the system proxy when macOS gains or switches its primary network service.
//!
//! Proxy settings live per network service. A write that found no service wrote nothing, and a
//! switch to another service leaves the proxy on the old one; both need the write repeated.

use crate::{
    config::Config,
    core::{CoreManager, proxy_control},
    process::scheduled_task::{self, Mailbox, Next, ScheduledTask},
};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use std::sync::{Arc, LazyLock};
use sysproxy::NetworkServiceMonitor;
use tokio::time::Instant;

static MONITOR: Mutex<Option<NetworkServiceMonitor>> = Mutex::new(None);

static REAPPLY_REQUESTS: LazyLock<Arc<Mailbox<bool>>> =
    LazyLock::new(|| scheduled_task::spawn(NetworkReapply::default(), |()| reapply()));

#[derive(Default)]
struct NetworkReapply {
    pending: bool,
}

impl ScheduledTask for NetworkReapply {
    type Input = bool;
    type Work = ();
    type Output = ();

    fn on_input(&mut self, requested: bool, _: Instant) {
        self.pending |= requested;
    }

    fn next(&mut self, _: Instant) -> Next<()> {
        if std::mem::take(&mut self.pending) {
            Next::Run(())
        } else {
            Next::Idle
        }
    }

    fn finished(&mut self, (): (), result: std::thread::Result<()>, _: Instant) {
        if result.is_err() {
            logging!(error, Type::Core, "network proxy reapply panicked");
        }
    }
}

pub fn is_armed() -> bool {
    MONITOR.lock().is_some()
}

/// Subscribe to the primary IPv4 service on the main run loop. Armed on return, so a service
/// appearing from here on is never missed.
pub fn start() {
    match NetworkServiceMonitor::start(|| {
        REAPPLY_REQUESTS.update(|pending| !std::mem::replace(pending, true));
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
        crate::utils::resolve::dns::sync_public_dns().await;
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

//! Re-apply the system proxy when macOS gains or switches its primary network service.
//!
//! Proxy settings live per network service. A write that found no service wrote nothing, and a
//! switch to another service leaves the proxy on the old one; both need the write repeated.

use crate::{config::Config, core::CoreManager, core::proxy_control, process::AsyncHandler};
use clash_verge_logging::{Type, logging};
use core_foundation::{
    array::CFArray,
    runloop::{CFRunLoop, kCFRunLoopCommonModes},
    string::CFString,
};
use std::sync::atomic::{AtomicBool, Ordering};
use system_configuration::dynamic_store::{SCDynamicStore, SCDynamicStoreBuilder, SCDynamicStoreCallBackContext};

/// Set once the subscription is live. Startup defers the proxy write to the watcher only then.
static ARMED: AtomicBool = AtomicBool::new(false);

pub fn is_armed() -> bool {
    ARMED.load(Ordering::Acquire)
}

/// Subscribe to the primary IPv4 service on the main run loop. Armed on return, so a service
/// appearing from here on is never missed.
pub fn start() {
    let store = SCDynamicStoreBuilder::new("clash-verge-rev")
        .callback_context(SCDynamicStoreCallBackContext {
            callout: on_change,
            info: (),
        })
        .build();
    let keys = CFArray::from_CFTypes(&[CFString::from_static_string("State:/Network/Global/IPv4")]);
    let Some(source) = store
        .filter(|store| store.set_notification_keys(&keys, &CFArray::<CFString>::from_CFTypes(&[])))
        .and_then(|store| store.create_run_loop_source())
    else {
        logging!(
            warn,
            Type::Core,
            "could not watch the network; the proxy is not re-applied on changes"
        );
        return;
    };
    CFRunLoop::get_main().add_source(&source, unsafe { kCFRunLoopCommonModes });
    ARMED.store(true, Ordering::Release);
}

fn on_change(_: SCDynamicStore, _: CFArray<CFString>, (): &mut ()) {
    AsyncHandler::spawn(reapply);
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
        || !proxy_control::has_network_service().await
    {
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

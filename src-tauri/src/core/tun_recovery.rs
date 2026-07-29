//! Rebuild TUN after the macOS primary network changes.
//!
//! System Configuration delivers default-network changes on a dedicated CFRunLoop.
//! A debounced async worker ensures a burst of DHCP and route updates causes at most
//! one Core restart.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use anyhow::{Context as _, Result, anyhow};
use clash_verge_logging::{Type, logging};
use core_foundation::{
    array::CFArray,
    base::{CFType, TCFType as _, ToVoid as _},
    dictionary::CFDictionary,
    propertylist::CFPropertyList,
    runloop::{CFRunLoop, kCFRunLoopCommonModes},
    string::CFString,
};
use parking_lot::Mutex;
use system_configuration::{
    dynamic_store::{SCDynamicStore, SCDynamicStoreBuilder, SCDynamicStoreCallBackContext},
    sys::schema_definitions::kSCDynamicStorePropNetPrimaryInterface,
};
use tokio::{
    sync::mpsc,
    time::{sleep, timeout},
};

use crate::{
    config::Config,
    core::{CoreManager, handle::Handle, manager::RunningMode},
    process::AsyncHandler,
    singleton,
};

const NETWORK_SETTLE_TIME: Duration = Duration::from_secs(2);
const NETWORK_READY_RETRY_INTERVAL: Duration = Duration::from_secs(2);
const NETWORK_READY_ATTEMPTS: usize = 6;

const GLOBAL_IPV4_KEY: &str = "State:/Network/Global/IPv4";
const GLOBAL_IPV6_KEY: &str = "State:/Network/Global/IPv6";

pub(crate) struct TunRecovery {
    sender: mpsc::UnboundedSender<()>,
    receiver: Mutex<Option<mpsc::UnboundedReceiver<()>>>,
    initialized: AtomicBool,
}

singleton!(TunRecovery, TUN_RECOVERY);

impl TunRecovery {
    fn new() -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        Self {
            sender,
            receiver: Mutex::new(Some(receiver)),
            initialized: AtomicBool::new(false),
        }
    }

    pub(crate) fn init(&self) -> Result<()> {
        if self.initialized.swap(true, Ordering::AcqRel) {
            return Ok(());
        }

        let receiver = self
            .receiver
            .lock()
            .take()
            .ok_or_else(|| anyhow!("TUN recovery event receiver is unavailable"))?;
        AsyncHandler::spawn(move || Self::run_recovery_worker(receiver));

        self.start_network_notifications()?;
        logging!(info, Type::Core, "macOS TUN recovery monitor initialized");
        Ok(())
    }

    fn start_network_notifications(&self) -> Result<()> {
        let sender = self.sender.clone();
        std::thread::Builder::new()
            .name("tun-network-monitor".into())
            .spawn(move || {
                if let Err(error) = run_network_notification_loop(sender) {
                    logging!(error, Type::Core, "macOS network notification loop stopped: {error:#}");
                }
            })
            .context("failed to start macOS network notification thread")?;
        Ok(())
    }

    async fn run_recovery_worker(mut receiver: mpsc::UnboundedReceiver<()>) {
        while receiver.recv().await.is_some() {
            if !wait_for_network_to_settle(&mut receiver).await {
                return;
            }

            if Handle::global().is_exiting() {
                return;
            }

            logging!(
                info,
                Type::Core,
                "macOS TUN recovery triggered by a primary network change"
            );
            Self::recover_when_network_ready().await;
        }
    }

    async fn recover_when_network_ready() {
        for attempt in 1..=NETWORK_READY_ATTEMPTS {
            if !tun_recovery_enabled().await || Handle::global().is_exiting() {
                return;
            }

            match usable_primary_interface() {
                Ok(Some(interface)) => {
                    Self::restart_core(interface).await;
                    return;
                }
                Ok(None) => {
                    logging!(
                        debug,
                        Type::Core,
                        "primary network is not ready for TUN recovery (attempt {attempt}/{NETWORK_READY_ATTEMPTS})"
                    );
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Core,
                        "failed to inspect the macOS primary network (attempt {attempt}/{NETWORK_READY_ATTEMPTS}): {error:#}"
                    );
                }
            }

            if attempt < NETWORK_READY_ATTEMPTS {
                sleep(NETWORK_READY_RETRY_INTERVAL).await;
            }
        }

        logging!(
            warn,
            Type::Core,
            "primary network did not become ready; TUN recovery was deferred"
        );
    }

    async fn restart_core(interface: String) {
        let manager = CoreManager::global();
        if matches!(*manager.get_running_mode(), RunningMode::NotRunning) {
            logging!(
                debug,
                Type::Core,
                "skipping TUN recovery because the Core is not running"
            );
            return;
        }

        logging!(
            info,
            Type::Core,
            "restarting the Core to rebuild TUN after macOS network recovery (primary interface: {interface})"
        );
        match manager.restart_core().await {
            Ok(()) => logging!(info, Type::Core, "macOS TUN recovery completed"),
            Err(error) => logging!(error, Type::Core, "macOS TUN recovery failed: {error:#}"),
        }
    }
}

async fn wait_for_network_to_settle(receiver: &mut mpsc::UnboundedReceiver<()>) -> bool {
    loop {
        match timeout(NETWORK_SETTLE_TIME, receiver.recv()).await {
            Ok(Some(())) => {}
            Ok(None) => return false,
            Err(_) => return true,
        }
    }
}

async fn tun_recovery_enabled() -> bool {
    Config::verge().await.latest_arc().enable_tun_mode.unwrap_or(false) && !Config::tun_suppressed_for_session()
}

fn usable_primary_interface() -> Result<Option<String>> {
    let store = SCDynamicStoreBuilder::new("clash-verge-tun-recovery")
        .build()
        .ok_or_else(|| anyhow!("failed to create macOS dynamic store"))?;

    Ok([GLOBAL_IPV4_KEY, GLOBAL_IPV6_KEY]
        .into_iter()
        .find_map(|key| primary_interface(&store, key).filter(|interface| is_usable_primary_interface(interface))))
}

fn primary_interface(store: &SCDynamicStore, key: &str) -> Option<String> {
    let network = store.get(key).and_then(CFPropertyList::downcast_into::<CFDictionary>)?;
    let value = network.find(unsafe { kSCDynamicStorePropNetPrimaryInterface }.to_void())?;
    let value = unsafe { CFType::wrap_under_get_rule(*value) };
    value.downcast_into::<CFString>().map(|interface| interface.to_string())
}

fn is_usable_primary_interface(interface: &str) -> bool {
    !interface.starts_with("utun") && interface != "lo0"
}

fn run_network_notification_loop(sender: mpsc::UnboundedSender<()>) -> Result<()> {
    let callback_context = SCDynamicStoreCallBackContext {
        callout: network_changed,
        info: sender,
    };
    let store = SCDynamicStoreBuilder::new("clash-verge-tun-network-monitor")
        .callback_context(callback_context)
        .build()
        .ok_or_else(|| anyhow!("failed to create macOS network notification store"))?;
    let keys = CFArray::from_CFTypes(&[CFString::from(GLOBAL_IPV4_KEY), CFString::from(GLOBAL_IPV6_KEY)]);
    let patterns = CFArray::<CFString>::from_CFTypes(&[]);

    if !store.set_notification_keys(&keys, &patterns) {
        anyhow::bail!("failed to register macOS network notification keys");
    }

    let source = store
        .create_run_loop_source()
        .ok_or_else(|| anyhow!("failed to create macOS network run-loop source"))?;
    CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
    CFRunLoop::run_current();
    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
fn network_changed(_store: SCDynamicStore, _changed_keys: CFArray<CFString>, sender: &mut mpsc::UnboundedSender<()>) {
    let _ = sender.send(());
}

#[cfg(test)]
mod tests {
    use super::is_usable_primary_interface;

    #[test]
    fn rejects_tun_and_loopback_as_usable_primary_interfaces() {
        assert!(!is_usable_primary_interface("utun4"));
        assert!(!is_usable_primary_interface("lo0"));
        assert!(is_usable_primary_interface("en0"));
        assert!(is_usable_primary_interface("bridge0"));
    }
}

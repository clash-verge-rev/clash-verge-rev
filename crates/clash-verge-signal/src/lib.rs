//! Linux-only termination signal bridge.
//!
//! Upstream Tauri delivers session-end and termination events to the app on
//! Windows and macOS, but has no equivalent on Linux: a desktop session may
//! end without any window or run event reaching the process. Linux builds
//! keep this crate to listen for SIGTERM, SIGINT and SIGHUP and forward them
//! to the app quit flow, so system proxy and TUN cleanup still runs before
//! the process dies. Non-Linux builds compile this crate to nothing and must
//! not depend on it.

#![cfg(target_os = "linux")]

use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};

use clash_verge_logging::{Type, logging};

mod unix;

pub(crate) static RUNTIME: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();
pub(crate) static SHUTDOWN_LATCH: ShutdownLatch = ShutdownLatch::new();

/// Serializes signal-triggered cleanups: a signal arriving while a quit
/// attempt is still in flight is dropped instead of overlapping it.
pub(crate) struct ShutdownLatch {
    is_cleaning_up: AtomicBool,
}

impl ShutdownLatch {
    const fn new() -> Self {
        Self {
            is_cleaning_up: AtomicBool::new(false),
        }
    }

    fn try_begin(&self) -> bool {
        self.is_cleaning_up
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn finish(&self) {
        self.is_cleaning_up.store(false, Ordering::Release);
    }
}

/// Spawns the Linux signal loop on a dedicated runtime so it survives the
/// teardown of any app-owned runtime. The handler runs once per accepted
/// signal; the quit flow it invokes owns the exit-or-cancel decision.
pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    RUNTIME.get_or_init(|| match tokio::runtime::Runtime::new() {
        Ok(rt) => Some(rt),
        Err(e) => {
            logging!(
                info,
                Type::SystemSignal,
                "register shutdown signal failed, create tokio runtime error: {}",
                e
            );
            None
        }
    });

    unix::register(f);
}

#[cfg(test)]
mod tests {
    use super::ShutdownLatch;

    #[test]
    fn finished_attempt_releases_latch_for_the_next_signal() {
        let latch = ShutdownLatch::new();

        assert!(latch.try_begin());
        assert!(!latch.try_begin());

        latch.finish();

        assert!(latch.try_begin());
    }
}

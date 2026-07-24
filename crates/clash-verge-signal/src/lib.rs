use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};

use clash_verge_logging::{Type, logging};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

pub(crate) static RUNTIME: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();
pub(crate) static SHUTDOWN_LATCH: ShutdownLatch = ShutdownLatch::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShutdownOutcome {
    Committed,
    Canceled,
}

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

    fn finish(&self, outcome: ShutdownOutcome) {
        if matches!(outcome, ShutdownOutcome::Canceled) {
            self.is_cleaning_up.store(false, Ordering::Release);
        }
    }
}

pub fn register<F, Fut>(f: F)
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ShutdownOutcome> + Send + 'static,
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

    #[cfg(unix)]
    unix::register(f);

    #[cfg(windows)]
    windows::register(f);
}

#[cfg(test)]
mod tests {
    use super::{ShutdownLatch, ShutdownOutcome};

    #[test]
    fn canceled_shutdown_releases_latch_and_permits_next_attempt() {
        let latch = ShutdownLatch::new();

        assert!(latch.try_begin());
        assert!(!latch.try_begin());

        latch.finish(ShutdownOutcome::Canceled);

        assert!(latch.try_begin());
    }

    #[test]
    fn committed_shutdown_retains_latch_and_suppresses_repeats() {
        let latch = ShutdownLatch::new();

        assert!(latch.try_begin());
        latch.finish(ShutdownOutcome::Committed);

        assert!(!latch.try_begin());
    }
}

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub type SystemLimiter = Limiter<SystemClock>;

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

impl<T: Clock + ?Sized> Clock for &T {
    fn now_ms(&self) -> u64 {
        (**self).now_ms()
    }
}

impl<T: Clock + ?Sized> Clock for Arc<T> {
    fn now_ms(&self) -> u64 {
        (**self).now_ms()
    }
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}

pub struct Limiter<C: Clock = SystemClock> {
    last_run_ms: AtomicU64,
    period_ms: u64,
    clock: C,
}

impl<C: Clock> Limiter<C> {
    pub const fn new(period: Duration, clock: C) -> Self {
        Self {
            last_run_ms: AtomicU64::new(0),
            period_ms: period.as_millis() as u64,
            clock,
        }
    }

    pub fn check(&self) -> bool {
        let now = self.clock.now_ms();
        let last = self.last_run_ms.load(Ordering::Relaxed);

        if now < last + self.period_ms && now >= last {
            return false;
        }

        self.last_run_ms
            .compare_exchange(last, now, Ordering::SeqCst, Ordering::Relaxed)
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicU64;

    use super::*;

    struct MockClock(AtomicU64);

    impl Clock for MockClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[test]
    fn enforces_the_period_boundary() {
        let clock = MockClock(AtomicU64::new(1_000));
        let limiter = Limiter::new(Duration::from_millis(100), &clock);

        assert!(limiter.check());
        clock.0.store(1_099, Ordering::SeqCst);
        assert!(!limiter.check());
        clock.0.store(1_100, Ordering::SeqCst);
        assert!(limiter.check());
    }

    #[test]
    fn concurrent_checks_admit_one_caller() {
        let clock = Arc::new(MockClock(AtomicU64::new(1_000)));
        let limiter = Arc::new(Limiter::new(Duration::from_millis(100), Arc::clone(&clock)));
        assert!(limiter.check());
        clock.0.store(1_100, Ordering::SeqCst);

        let mut handles = Vec::with_capacity(8);
        for _ in 0..8 {
            let limiter = Arc::clone(&limiter);
            handles.push(std::thread::spawn(move || limiter.check()));
        }
        let admitted = handles
            .into_iter()
            .map(|handle| handle.join().unwrap_or(false))
            .filter(|passed| *passed)
            .count();

        assert_eq!(admitted, 1);
    }
}

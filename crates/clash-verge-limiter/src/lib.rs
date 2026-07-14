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
mod extra_tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    struct MockClock(AtomicU64);
    impl Clock for MockClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[test]
    fn test_zero_period_always_passes() {
        let mock = MockClock(AtomicU64::new(100));
        let limiter = Limiter::new(Duration::from_millis(0), &mock);

        assert!(limiter.check());
        assert!(limiter.check());
    }

    #[test]
    fn test_boundary_condition() {
        let period_ms = 100;
        let mock = MockClock(AtomicU64::new(1000));
        let limiter = Limiter::new(Duration::from_millis(period_ms), &mock);

        assert!(limiter.check());

        mock.0.store(1099, Ordering::SeqCst);
        assert!(!limiter.check());

        mock.0.store(1100, Ordering::SeqCst);
        assert!(limiter.check(), "Should pass exactly at period boundary");
    }

    #[test]
    fn test_high_concurrency_consistency() {
        let period = Duration::from_millis(1000);
        let mock = Arc::new(MockClock(AtomicU64::new(1000)));
        let limiter = Arc::new(Limiter::new(period, Arc::clone(&mock)));

        assert!(limiter.check());

        mock.0.store(2500, Ordering::SeqCst);

        let mut handles = vec![];
        for _ in 0..20 {
            let l = Arc::clone(&limiter);
            handles.push(thread::spawn(move || l.check()));
        }

        #[allow(clippy::unwrap_used)]
        let results: Vec<bool> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        let success_count = results.iter().filter(|&&x| x).count();
        assert_eq!(success_count, 1);

        assert_eq!(limiter.last_run_ms.load(Ordering::SeqCst), 2500);
    }

    #[test]
    fn test_extreme_time_jump() {
        let mock = MockClock(AtomicU64::new(100));
        let limiter = Limiter::new(Duration::from_millis(100), &mock);

        assert!(limiter.check());

        mock.0.store(u64::MAX - 10, Ordering::SeqCst);
        assert!(limiter.check());
    }

    #[test]
    fn test_system_clock_real_path() {
        let clock = SystemClock;
        let start = clock.now_ms();
        assert!(start > 0);

        std::thread::sleep(Duration::from_millis(10));
        assert!(clock.now_ms() >= start);
    }

    #[test]
    fn test_limiter_with_system_clock_default() {
        let limiter = Limiter::new(Duration::from_millis(100), SystemClock);
        assert!(limiter.check());
    }

    #[test]
    fn test_coverage_time_backward() {
        let mock = MockClock(AtomicU64::new(5000));
        let limiter = Limiter::new(Duration::from_millis(100), &mock);

        assert!(limiter.check());

        mock.0.store(4000, Ordering::SeqCst);

        assert!(limiter.check(), "Should pass and reset when time moves backward");

        assert_eq!(limiter.last_run_ms.load(Ordering::SeqCst), 4000);
    }
}

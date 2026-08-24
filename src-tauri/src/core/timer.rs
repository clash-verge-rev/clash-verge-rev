use crate::{
    config::{Config, PrfItem},
    feat,
    process::AsyncHandler,
    singleton,
    utils::resolve::is_resolve_done,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging, logging_error};
use parking_lot::{Mutex, RwLock};
use smartstring::alias::String;
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::mpsc,
    time::{sleep, timeout},
};
use tokio_stream::StreamExt as _;
use tokio_util::time::{DelayQueue, delay_queue::Key};

enum TimerCommand {
    Apply(HashMap<String, TaskSchedule>),
    RunNow(String),
    TaskFinished(String),
}

/// Next update is due at `updated + interval`, but the queue only takes a delay from now.
#[derive(Debug, PartialEq, Eq)]
struct TaskSchedule {
    interval_minutes: u64,
    first_delay: Duration,
}

impl TaskSchedule {
    /// No recorded `updated` -> full interval. Deadline already past -> `ZERO`, fires at once.
    fn new(interval_minutes: u64, updated: Option<usize>, now: i64) -> Self {
        let full = Timer::interval_duration(interval_minutes);
        let elapsed = updated
            .filter(|updated| *updated > 0)
            .map_or(0, |updated| now.saturating_sub(updated as i64).max(0) as u64);

        Self {
            interval_minutes,
            first_delay: full.saturating_sub(Duration::from_secs(elapsed)),
        }
    }
}

struct TaskState {
    key: Option<Key>,
    interval_minutes: u64,
    running: bool,
    /// Disabled mid-update. Entry outlives removal so re-enabling reuses the `running` guard
    /// instead of building a fresh state that would fire a second update at zero delay.
    retired: bool,
}

async fn run_timer_profile_update_transition<Started, Update, UpdateFuture, Finished, Completed, Output>(
    update_started: Started,
    update_profile: Update,
    update_finished: Finished,
    update_completed: Completed,
) where
    Started: FnOnce(),
    Update: FnOnce() -> UpdateFuture,
    UpdateFuture: std::future::Future<Output = Output>,
    Finished: FnOnce(Output),
    Completed: FnOnce(),
{
    update_started();
    let result = update_profile().await;
    update_finished(result);
    update_completed();
}

impl TaskState {
    const fn new(key: Key, interval_minutes: u64) -> Self {
        Self {
            key: Some(key),
            interval_minutes,
            running: false,
            retired: false,
        }
    }
}

pub struct Timer {
    command_tx: mpsc::UnboundedSender<TimerCommand>,
    command_rx: Mutex<Option<mpsc::UnboundedReceiver<TimerCommand>>>,
    refresh_lock: tokio::sync::Mutex<()>,
    pub timer_map: Arc<RwLock<HashMap<String, u64>>>,
    pub initialized: AtomicBool,
}

singleton!(Timer, TIMER_INSTANCE);

impl Timer {
    fn new() -> Self {
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        Self {
            command_tx,
            command_rx: Mutex::new(Some(command_rx)),
            refresh_lock: tokio::sync::Mutex::new(()),
            timer_map: Arc::new(RwLock::new(HashMap::new())),
            initialized: AtomicBool::new(false),
        }
    }

    pub async fn init(&self) -> Result<()> {
        if self
            .initialized
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            logging!(debug, Type::Timer, "Timer already initialized, skipping...");
            return Ok(());
        }

        let command_rx = { self.command_rx.lock().take() };
        if let Some(command_rx) = command_rx {
            let command_tx = self.command_tx.clone();
            AsyncHandler::spawn(move || async move {
                Self::run_scheduler(command_rx, command_tx).await;
            });
        }

        if let Err(e) = self.refresh().await {
            self.initialized.store(false, Ordering::SeqCst);
            logging_error!(Type::Timer, "Failed to initialize timer: {}", e);
            return Err(e);
        }

        {
            let timer_map = self.timer_map.read();
            logging!(debug, Type::Timer, "Registered timer task count: {}", timer_map.len());
            for (uid, interval) in timer_map.iter() {
                logging!(
                    debug,
                    Type::Timer,
                    "Registered timer task: uid={}, interval={}min",
                    uid,
                    interval
                );
            }
        }

        // Redundant with first_delay == ZERO, kept as the immediate path; mark_task_running
        // no-ops whichever of the two arrives second.
        let cur_timestamp = chrono::Local::now().timestamp();
        if let Some(items) = Config::profiles().await.data_arc().items.as_ref() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref()
                    && option.allow_auto_update.unwrap_or(true)
                    && let Some(interval) = option.update_interval
                    && interval > 0
                    && let Some(uid) = item.uid.as_ref()
                    && let Some(updated) = item.updated
                    && cur_timestamp - (updated as i64) >= (interval as i64) * 60
                {
                    logging!(info, Type::Timer, "Running overdue timer task immediately: uid={}", uid);
                    let _ = self.command_tx.send(TimerCommand::RunNow(uid.clone()));
                }
            }
        }

        logging!(info, Type::Timer, "Timer initialization completed");
        Ok(())
    }

    pub async fn refresh(&self) -> Result<()> {
        let _refresh_guard = self.refresh_lock.lock().await;
        let new_schedule = self.gen_map().await;
        // Cache intervals only: first_delay shrinks every second, so comparing it would make
        // every refresh look like a change.
        let new_map: HashMap<String, u64> = new_schedule
            .iter()
            .map(|(uid, schedule)| (uid.clone(), schedule.interval_minutes))
            .collect();

        let mut cache = self.timer_map.write();
        if *cache == new_map {
            logging!(debug, Type::Timer, "No timer changes needed");
            return Ok(());
        }

        logging!(
            info,
            Type::Timer,
            "Refreshing timer tasks map, count: {}",
            new_map.len()
        );
        *cache = new_map;
        drop(cache);

        let _ = self.command_tx.send(TimerCommand::Apply(new_schedule));

        Ok(())
    }

    async fn gen_map(&self) -> HashMap<String, TaskSchedule> {
        if let Some(items) = Config::profiles().await.data_arc().items.as_ref() {
            return Self::gen_map_from_items(items);
        }

        HashMap::new()
    }

    fn gen_map_from_items(items: &[PrfItem]) -> HashMap<String, TaskSchedule> {
        let now = chrono::Local::now().timestamp();
        let mut new_map = HashMap::new();

        for item in items {
            if let Some(option) = item.option.as_ref()
                && let (Some(interval), Some(uid)) = (option.update_interval, &item.uid)
                && option.allow_auto_update.unwrap_or(true)
                && interval > 0
            {
                new_map.insert(uid.clone(), TaskSchedule::new(interval, item.updated, now));
            }
        }

        new_map
    }

    async fn run_scheduler(
        mut command_rx: mpsc::UnboundedReceiver<TimerCommand>,
        command_tx: mpsc::UnboundedSender<TimerCommand>,
    ) {
        let mut queue = DelayQueue::new();
        let mut tasks = HashMap::new();

        loop {
            tokio::select! {
                Some(expired) = queue.next() => {
                    let uid = expired.into_inner();
                    Self::run_expired_task(&mut tasks, uid, command_tx.clone());
                }

                command = command_rx.recv() => {
                    match command {
                        Some(TimerCommand::Apply(new_map)) => {
                            Self::apply_timer_map(&mut queue, &mut tasks, new_map);
                        }
                        Some(TimerCommand::RunNow(uid)) => {
                            Self::run_task_now(&mut queue, &mut tasks, uid, command_tx.clone());
                        }
                        Some(TimerCommand::TaskFinished(uid)) => {
                            Self::finish_task(&mut queue, &mut tasks, uid);
                        }
                        None => break,
                    }
                }
            }
        }
    }

    fn apply_timer_map(
        queue: &mut DelayQueue<String>,
        tasks: &mut HashMap<String, TaskState>,
        new_map: HashMap<String, TaskSchedule>,
    ) {
        tasks.retain(|uid, state| {
            if new_map.contains_key(uid) {
                return true;
            }

            if let Some(key) = state.key.take() {
                queue.remove(&key);
            }

            if state.running {
                state.retired = true;
                logging!(
                    debug,
                    Type::Timer,
                    "Retiring timer task once its in-flight update reports back: uid={}",
                    uid
                );
                return true;
            }

            logging!(debug, Type::Timer, "Removed timer task for uid={}", uid);
            false
        });

        for (uid, schedule) in new_map {
            let Some(state) = tasks.get_mut(&uid) else {
                Self::insert_task(queue, tasks, uid, &schedule);
                continue;
            };

            // Re-enabled before retirement took effect; finish_task re-arms it.
            state.retired = false;

            if state.interval_minutes == schedule.interval_minutes {
                continue;
            }

            Self::update_task_interval(queue, &uid, state, &schedule);
        }
    }

    fn insert_task(
        queue: &mut DelayQueue<String>,
        tasks: &mut HashMap<String, TaskState>,
        uid: String,
        schedule: &TaskSchedule,
    ) {
        let key = Self::schedule_task(queue, &uid, schedule.first_delay);
        logging!(
            debug,
            Type::Timer,
            "Added timer task: uid={}, interval={}min, first fire in {}s",
            uid,
            schedule.interval_minutes,
            schedule.first_delay.as_secs()
        );
        tasks.insert(uid, TaskState::new(key, schedule.interval_minutes));
    }

    fn update_task_interval(queue: &mut DelayQueue<String>, uid: &str, state: &mut TaskState, schedule: &TaskSchedule) {
        state.interval_minutes = schedule.interval_minutes;

        if let Some(key) = state.key.as_ref() {
            queue.reset(key, schedule.first_delay);
        } else if !state.running {
            state.key = Some(Self::schedule_task(queue, uid, schedule.first_delay));
        }

        logging!(
            debug,
            Type::Timer,
            "Updated timer task interval: uid={}, interval={}min, next fire in {}s",
            uid,
            schedule.interval_minutes,
            schedule.first_delay.as_secs()
        );
    }

    fn run_expired_task(
        tasks: &mut HashMap<String, TaskState>,
        uid: String,
        command_tx: mpsc::UnboundedSender<TimerCommand>,
    ) {
        let Some(state) = tasks.get_mut(&uid) else {
            return;
        };

        state.key = None;
        if !Self::mark_task_running(state, &uid, false) {
            return;
        }

        Self::spawn_update_task(uid, command_tx);
    }

    fn run_task_now(
        queue: &mut DelayQueue<String>,
        tasks: &mut HashMap<String, TaskState>,
        uid: String,
        command_tx: mpsc::UnboundedSender<TimerCommand>,
    ) {
        let Some(state) = tasks.get_mut(&uid) else {
            return;
        };

        if !Self::mark_task_running(state, &uid, true) {
            return;
        }

        if let Some(key) = state.key.take() {
            queue.remove(&key);
        }
        Self::spawn_update_task(uid, command_tx);
    }

    fn mark_task_running(state: &mut TaskState, uid: &str, immediate: bool) -> bool {
        if !state.running {
            state.running = true;
            return true;
        }

        if immediate {
            logging!(
                debug,
                Type::Timer,
                "Timer task already running, skip immediate uid={}",
                uid
            );
        } else {
            logging!(debug, Type::Timer, "Timer task already running, skip uid={}", uid);
        }
        false
    }

    fn finish_task(queue: &mut DelayQueue<String>, tasks: &mut HashMap<String, TaskState>, uid: String) {
        let Some(state) = tasks.get_mut(&uid) else {
            return;
        };

        state.running = false;

        if state.retired {
            tasks.remove(&uid);
            logging!(
                debug,
                Type::Timer,
                "Dropped retired timer task now that its update finished: uid={}",
                uid
            );
            return;
        }

        // Full interval, not from `updated`: a failed run leaves `updated` in the past, so
        // counting from it would retry at zero delay and spin.
        let key = Self::schedule_task(queue, &uid, Self::interval_duration(state.interval_minutes));
        state.key = Some(key);
    }

    fn spawn_update_task(uid: String, command_tx: mpsc::UnboundedSender<TimerCommand>) {
        logging!(info, Type::Timer, "Starting timer task: uid={}", uid);
        AsyncHandler::spawn(move || async move {
            Self::wait_until_resolve_done(Duration::from_millis(5000)).await;
            Self::async_task(&uid).await;
            let _ = command_tx.send(TimerCommand::TaskFinished(uid));
        });
    }

    const fn interval_duration(interval_minutes: u64) -> Duration {
        Duration::from_secs(interval_minutes.saturating_mul(60))
    }

    fn schedule_task(queue: &mut DelayQueue<String>, uid: &str, delay: Duration) -> Key {
        queue.insert(String::from(uid), delay)
    }

    pub async fn get_next_update_time(&self, uid: &str) -> Option<i64> {
        logging!(debug, Type::Timer, "Getting next update time, uid={}", uid);

        let task_interval = *self.timer_map.read().get(uid)?;
        let profiles = Config::profiles().await;
        let profiles_guard = profiles.latest_arc();
        let items = profiles_guard.items.as_ref()?;

        let profile = items.iter().find(|item| item.uid.as_deref() == Some(uid))?;
        let updated = profile.updated.unwrap_or(0) as i64;

        if updated > 0 {
            Some(updated + (task_interval as i64 * 60))
        } else {
            None
        }
    }

    fn emit_update_event(uid: &String, is_start: bool) {
        if is_start {
            super::handle::Handle::notify_profile_update_started(uid);
        } else {
            super::handle::Handle::notify_profile_update_completed(uid);
        }
    }

    async fn async_task(uid: &String) {
        let task_start = std::time::Instant::now();
        logging!(debug, Type::Timer, "Running timer task for profile: {}", uid);

        run_timer_profile_update_transition(
            || Self::emit_update_event(uid, true),
            || async {
                let is_current = Config::profiles().await.latest_arc().current.as_ref() == Some(uid);
                logging!(
                    debug,
                    Type::Timer,
                    "Profile {} is current active profile: {}",
                    uid,
                    is_current
                );

                feat::update_profile(uid, None, is_current, false, false).await
            },
            |result| match result {
                Ok(_) => {
                    logging!(
                        info,
                        Type::Timer,
                        "Timer task completed for uid: {} (took {}ms)",
                        uid,
                        task_start.elapsed().as_millis()
                    );
                }
                Err(e) => logging_error!(Type::Timer, "Failed to update profile uid {}: {}", uid, e),
            },
            || Self::emit_update_event(uid, false),
        )
        .await;
    }

    async fn wait_until_resolve_done(max_wait: Duration) {
        let _ = timeout(max_wait, async {
            while !is_resolve_done() {
                logging!(debug, Type::Timer, "Waiting for resolve to be done...");
                sleep(Duration::from_millis(200)).await;
            }
        })
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskSchedule, Timer, run_timer_profile_update_transition};
    use crate::config::{PrfItem, PrfOption};
    use parking_lot::Mutex;
    use smartstring::alias::String;
    use std::collections::HashMap;
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        task::Poll,
        time::Duration,
    };
    use tokio::sync::Barrier;
    use tokio_stream::StreamExt as _;
    use tokio_util::time::DelayQueue;

    struct CancellationProbe {
        cancelled: Arc<AtomicBool>,
        completed: Arc<AtomicBool>,
    }

    impl Drop for CancellationProbe {
        fn drop(&mut self) {
            if !self.completed.load(Ordering::Acquire) {
                self.cancelled.store(true, Ordering::Release);
            }
        }
    }

    fn remote_profile(uid: &str, allow_auto_update: Option<bool>, update_interval: Option<u64>) -> PrfItem {
        PrfItem {
            uid: Some(uid.into()),
            itype: Some("remote".into()),
            option: Some(PrfOption {
                allow_auto_update,
                update_interval,
                ..PrfOption::default()
            }),
            ..PrfItem::default()
        }
    }

    #[test]
    fn timer_map_only_contains_enabled_profiles_with_positive_intervals() {
        let items = vec![
            remote_profile("enabled", Some(true), Some(30)),
            remote_profile("disabled", Some(false), Some(30)),
            remote_profile("missing-flag", None, Some(30)),
            remote_profile("zero-interval", Some(true), Some(0)),
            remote_profile("missing-interval", Some(true), None),
        ];

        let map = Timer::gen_map_from_items(&items);

        assert_eq!(map.len(), 2);
        assert_eq!(map.get("enabled").map(|s| s.interval_minutes), Some(30));
        assert_eq!(map.get("missing-flag").map(|s| s.interval_minutes), Some(30));
    }

    #[test]
    fn first_fire_counts_from_the_last_update_not_from_now() {
        const NOW: i64 = 1_700_000_000;
        const HOUR: u64 = 60;

        let fresh = TaskSchedule::new(HOUR, Some(NOW as usize), NOW);
        assert_eq!(
            fresh.first_delay,
            Duration::from_secs(3600),
            "a profile updated this instant waits the whole interval"
        );

        let half_elapsed = TaskSchedule::new(HOUR, Some((NOW - 1800) as usize), NOW);
        assert_eq!(
            half_elapsed.first_delay,
            Duration::from_secs(1800),
            "half the interval already spent leaves half of it, not a fresh hour"
        );

        // Guards the reported bug: raising an interval used to push the deadline a full
        // interval past the raise while the UI still reported `updated + interval`.
        let raised = TaskSchedule::new(1440, Some((NOW - 1439 * 60) as usize), NOW);
        assert_eq!(raised.first_delay, Duration::from_secs(60));

        let overdue = TaskSchedule::new(HOUR, Some((NOW - 7200) as usize), NOW);
        assert_eq!(
            overdue.first_delay,
            Duration::ZERO,
            "a deadline already past fires as soon as the queue is drained"
        );

        for unknown in [None, Some(0)] {
            assert_eq!(
                TaskSchedule::new(HOUR, unknown, NOW).first_delay,
                Duration::from_secs(3600),
                "with no recorded update there is no deadline to count from"
            );
        }

        let skewed = TaskSchedule::new(HOUR, Some((NOW + 9999) as usize), NOW);
        assert_eq!(
            skewed.first_delay,
            Duration::from_secs(3600),
            "a timestamp in the future must not extend the delay past one interval"
        );
    }

    /// Polled, not awaited: a not-yet-due entry would park the test on the paused clock.
    async fn take_expired(queue: &mut DelayQueue<String>) -> Option<String> {
        match futures::poll!(Box::pin(queue.next())) {
            Poll::Ready(Some(expired)) => Some(expired.into_inner()),
            _ => None,
        }
    }

    /// What `run_expired_task` does, minus spawning the real update.
    fn mark_running(tasks: &mut HashMap<String, super::TaskState>, uid: &str) {
        assert!(tasks.contains_key(uid), "task {uid} must exist before it can run");

        if let Some(state) = tasks.get_mut(uid) {
            state.key = None;
            state.running = true;
        }
    }

    /// Empty queue reports `Ready(None)`, not `Pending`, so both count as "nothing due".
    async fn nothing_due(queue: &mut DelayQueue<String>) -> bool {
        matches!(
            futures::poll!(Box::pin(queue.next())),
            Poll::Pending | Poll::Ready(None)
        )
    }

    #[tokio::test(start_paused = true)]
    async fn queue_fires_at_the_remaining_time_then_waits_a_whole_interval() {
        const NOW: i64 = 1_700_000_000;

        let mut queue = DelayQueue::new();
        let mut tasks = HashMap::new();

        // 1439min into a 1440min interval: due in a minute, not a day.
        let mut map = HashMap::new();
        map.insert(
            String::from("uid"),
            TaskSchedule::new(1440, Some((NOW - 1439 * 60) as usize), NOW),
        );
        Timer::apply_timer_map(&mut queue, &mut tasks, map);

        tokio::time::advance(Duration::from_secs(61)).await;
        assert_eq!(
            take_expired(&mut queue).await.as_deref(),
            Some("uid"),
            "the raised interval must fire one minute in, not a full day in"
        );

        // After it reports back, the next one is a whole interval away.
        mark_running(&mut tasks, "uid");
        Timer::finish_task(&mut queue, &mut tasks, String::from("uid"));

        tokio::time::advance(Duration::from_secs(1439 * 60)).await;
        assert!(
            nothing_due(&mut queue).await,
            "a finished task waits the whole interval, not the remainder of the old one"
        );

        tokio::time::advance(Duration::from_secs(120)).await;
        assert_eq!(take_expired(&mut queue).await.as_deref(), Some("uid"));
    }

    #[tokio::test(start_paused = true)]
    async fn disabling_a_profile_mid_update_cannot_start_a_second_one() {
        const NOW: i64 = 1_700_000_000;

        let mut queue = DelayQueue::new();
        let mut tasks = HashMap::new();
        // Overdue: every re-insert would land at zero delay.
        let schedule = || TaskSchedule::new(60, Some((NOW - 7200) as usize), NOW);

        let mut map = HashMap::new();
        map.insert(String::from("uid"), schedule());
        Timer::apply_timer_map(&mut queue, &mut tasks, map);
        assert_eq!(take_expired(&mut queue).await.as_deref(), Some("uid"));
        mark_running(&mut tasks, "uid");

        // Toggled off then on while the run is still in flight.
        Timer::apply_timer_map(&mut queue, &mut tasks, HashMap::new());
        let mut back_on = HashMap::new();
        back_on.insert(String::from("uid"), schedule());
        Timer::apply_timer_map(&mut queue, &mut tasks, back_on);

        assert!(
            tasks.get("uid").is_some_and(|state| state.running),
            "the entry must survive the toggle so the in-flight run is still accounted for"
        );
        assert!(
            nothing_due(&mut queue).await,
            "re-enabling must not queue a second run alongside the one already going"
        );

        // Original run reports back, re-arms exactly once.
        Timer::finish_task(&mut queue, &mut tasks, String::from("uid"));
        tokio::time::advance(Duration::from_secs(3601)).await;
        assert_eq!(take_expired(&mut queue).await.as_deref(), Some("uid"));
        assert!(nothing_due(&mut queue).await, "exactly one key, no orphan");
    }

    #[tokio::test(start_paused = true)]
    async fn a_profile_disabled_mid_update_is_dropped_when_it_reports_back() {
        const NOW: i64 = 1_700_000_000;

        let mut queue = DelayQueue::new();
        let mut tasks = HashMap::new();

        let mut map = HashMap::new();
        map.insert(
            String::from("uid"),
            TaskSchedule::new(60, Some((NOW - 7200) as usize), NOW),
        );
        Timer::apply_timer_map(&mut queue, &mut tasks, map);
        assert_eq!(take_expired(&mut queue).await.as_deref(), Some("uid"));
        mark_running(&mut tasks, "uid");

        Timer::apply_timer_map(&mut queue, &mut tasks, HashMap::new());
        Timer::finish_task(&mut queue, &mut tasks, String::from("uid"));

        assert!(
            tasks.is_empty(),
            "a task retired mid-update must not outlive the update"
        );
        tokio::time::advance(Duration::from_secs(7200)).await;
        assert!(nothing_due(&mut queue).await, "and must never be scheduled again");
    }

    #[tokio::test(start_paused = true)]
    async fn timer_profile_update_runs_past_former_deadline_and_pairs_events() -> anyhow::Result<()> {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let update_started = Arc::new(Barrier::new(2));
        let release_update = Arc::new(Barrier::new(2));
        let update_cancelled = Arc::new(AtomicBool::new(false));
        let update_completed = Arc::new(AtomicBool::new(false));

        let mut update = Box::pin(run_timer_profile_update_transition(
            {
                let calls = Arc::clone(&calls);
                move || calls.lock().push("update-started")
            },
            {
                let update_started = Arc::clone(&update_started);
                let release_update = Arc::clone(&release_update);
                let update_cancelled = Arc::clone(&update_cancelled);
                let update_completed = Arc::clone(&update_completed);
                move || async move {
                    let _probe = CancellationProbe {
                        cancelled: update_cancelled,
                        completed: Arc::clone(&update_completed),
                    };
                    update_started.wait().await;
                    release_update.wait().await;
                    update_completed.store(true, Ordering::Release);
                    Ok::<(), anyhow::Error>(())
                }
            },
            {
                let calls = Arc::clone(&calls);
                move |result: anyhow::Result<()>| {
                    assert!(result.is_ok());
                    calls.lock().push("terminal-result");
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || calls.lock().push("update-completed")
            },
        ));

        assert!(matches!(futures::poll!(update.as_mut()), Poll::Pending));
        update_started.wait().await;
        tokio::time::advance(Duration::from_secs(41)).await;

        assert!(matches!(futures::poll!(update.as_mut()), Poll::Pending));
        assert!(!update_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["update-started"]);

        release_update.wait().await;
        update.await;
        assert!(update_completed.load(Ordering::Acquire));
        assert!(!update_cancelled.load(Ordering::Acquire));
        assert_eq!(
            &*calls.lock(),
            &["update-started", "terminal-result", "update-completed"]
        );
        Ok(())
    }
}

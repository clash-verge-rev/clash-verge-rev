use crate::{config::Config, feat, process::AsyncHandler, singleton, utils::resolve::is_resolve_done};
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
    Apply(HashMap<String, u64>),
    RunNow(String),
    TaskFinished(String),
}

struct TaskState {
    key: Option<Key>,
    interval_minutes: u64,
    running: bool,
}

impl TaskState {
    const fn new(key: Key, interval_minutes: u64) -> Self {
        Self {
            key: Some(key),
            interval_minutes,
            running: false,
        }
    }
}

pub struct Timer {
    command_tx: mpsc::UnboundedSender<TimerCommand>,
    command_rx: Mutex<Option<mpsc::UnboundedReceiver<TimerCommand>>>,
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

        let cur_timestamp = chrono::Local::now().timestamp();
        if let Some(items) = Config::profiles().await.latest_arc().get_items() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref()
                    && let Some(allow_auto_update) = option.allow_auto_update
                    && allow_auto_update
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
        let new_map = self.gen_map().await;

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
        *cache = new_map.clone();
        drop(cache);

        let _ = self.command_tx.send(TimerCommand::Apply(new_map));

        Ok(())
    }

    async fn gen_map(&self) -> HashMap<String, u64> {
        let mut new_map = HashMap::new();

        if let Some(items) = Config::profiles().await.latest_arc().get_items() {
            for item in items.iter() {
                if let Some(option) = item.option.as_ref()
                    && let Some(allow_auto_update) = option.allow_auto_update
                    && let (Some(interval), Some(uid)) = (option.update_interval, &item.uid)
                    && allow_auto_update
                    && interval > 0
                {
                    new_map.insert(uid.clone(), interval);
                }
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
        new_map: HashMap<String, u64>,
    ) {
        tasks.retain(|uid, state| {
            if new_map.contains_key(uid) {
                return true;
            }

            if let Some(key) = state.key.take() {
                queue.remove(&key);
            }
            logging!(debug, Type::Timer, "Removed timer task for uid={}", uid);
            false
        });

        for (uid, interval_minutes) in new_map {
            let Some(state) = tasks.get_mut(&uid) else {
                Self::insert_task(queue, tasks, uid, interval_minutes);
                continue;
            };

            if state.interval_minutes == interval_minutes {
                continue;
            }

            Self::update_task_interval(queue, &uid, state, interval_minutes);
        }
    }

    fn insert_task(
        queue: &mut DelayQueue<String>,
        tasks: &mut HashMap<String, TaskState>,
        uid: String,
        interval_minutes: u64,
    ) {
        let key = Self::schedule_task(queue, &uid, interval_minutes);
        logging!(
            debug,
            Type::Timer,
            "Added timer task: uid={}, interval={}min",
            uid,
            interval_minutes
        );
        tasks.insert(uid, TaskState::new(key, interval_minutes));
    }

    fn update_task_interval(queue: &mut DelayQueue<String>, uid: &str, state: &mut TaskState, interval_minutes: u64) {
        state.interval_minutes = interval_minutes;

        if let Some(key) = state.key.as_ref() {
            queue.reset(key, Self::interval_duration(interval_minutes));
        } else if !state.running {
            state.key = Some(Self::schedule_task(queue, uid, interval_minutes));
        }

        logging!(
            debug,
            Type::Timer,
            "Updated timer task interval: uid={}, interval={}min",
            uid,
            interval_minutes
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
        let key = Self::schedule_task(queue, &uid, state.interval_minutes);
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

    fn schedule_task(queue: &mut DelayQueue<String>, uid: &str, interval_minutes: u64) -> Key {
        queue.insert(String::from(uid), Self::interval_duration(interval_minutes))
    }

    pub async fn get_next_update_time(&self, uid: &str) -> Option<i64> {
        logging!(debug, Type::Timer, "Getting next update time, uid={}", uid);

        let task_interval = *self.timer_map.read().get(uid)?;
        let profiles = Config::profiles().await;
        let profiles_guard = profiles.latest_arc();
        let items = profiles_guard.get_items()?;

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

        match tokio::time::timeout(std::time::Duration::from_secs(40), async {
            Self::emit_update_event(uid, true);

            let is_current = Config::profiles().await.latest_arc().current.as_ref() == Some(uid);
            logging!(
                debug,
                Type::Timer,
                "Profile {} is current active profile: {}",
                uid,
                is_current
            );

            feat::update_profile(uid, None, is_current, false, false).await
        })
        .await
        {
            Ok(Ok(_)) => {
                logging!(
                    info,
                    Type::Timer,
                    "Timer task completed for uid: {} (took {}ms)",
                    uid,
                    task_start.elapsed().as_millis()
                );
            }
            Ok(Err(e)) => logging_error!(Type::Timer, "Failed to update profile uid {}: {}", uid, e),
            Err(_) => logging_error!(Type::Timer, "Timer task timed out for uid: {}", uid),
        }

        Self::emit_update_event(uid, false);
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
